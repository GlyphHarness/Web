// Writes scripts/fixtures/metrics-sessions.json: two invented sessions (no real data) for the metrics panel smoke test.
// Every message holds the sentinel SECRET-CONTENT so the test can check that no text reaches a widget.
import fs from 'node:fs';
const S = 'SECRET-CONTENT';
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const tool = (id, content) => ({ role: 'tool', tool_call_id: id, content });
const row = (o) => ({ t: 1700000000000, kept: 0, chars: 1000, ...o });
const A = {
  id: 'sfixA', title: 'Fixture A: stem run', created: 1700000000000, system: S, padSeen: {},
  messages: [
    { role: 'user', content: `${S} please look at the repo and fix the thing, with a long enough request to count as a full turn ${'x'.repeat(260)}` },
    { role: 'assistant', content: S, tool_calls: [call('c1', 'repo_read', { path: S }), call('c2', 'repo_read', { path: S }), call('c3', 'file_edit', { path: S })] },
    tool('c1', 'ok ' + S), tool('c2', 'ok ' + S), tool('c3', 'Tool error: ' + S),
    { role: 'assistant', content: S },
    { role: 'user', content: 'and again' },
    { role: 'assistant', content: S, tool_calls: [call('c4', 'repo_commit', { m: S }), call('c5', 'shell', { cmd: S })] },
    tool('c4', 'ok ' + S), tool('c5', 'Not run: policy ' + S),
    { role: 'assistant', content: S },
  ],
  ledger: [
    row({ model: 'vendor/model-a', strat: 'strat-stem-2.0', prompt: 4000, cached: 0, cacheWrite: 3800, completion: 300, reasoning: 120, cost: 0.0123 }),
    row({ model: 'vendor/model-a', strat: 'strat-stem-2.0', prompt: 4500, cached: 3800, cacheWrite: 600, completion: 250, reasoning: 90, cost: 0.0061 }),
    row({ helper: true, kind: 'squeeze', model: 'vendor/small', prompt: 1200, cached: 0, completion: 80, reasoning: 0, cost: 0.0004 }),
    row({ model: 'vendor/model-a', strat: 'strat-stem-2.0', prompt: 5200, cached: 4400, cacheWrite: 700, completion: 400, reasoning: 200, cost: 0.0072 }),
    row({ model: 'vendor/model-a', strat: 'strat-stem-2.0', prompt: 6100, cached: 5800, cacheWrite: 300, completion: 150, reasoning: 40, cost: 0.0049 }),
    row({ helper: true, kind: 'policy', model: 'vendor/small', prompt: 900, cached: 0, completion: 60, reasoning: 0, cost: 0.0003 }),
    row({ model: 'vendor/model-a', strat: 'strat-stem-2.0', prompt: 6800, cached: 6100, cacheWrite: 700, completion: 500, reasoning: 220, cost: 0.0088 }),
  ],
  flags: [{ tool: 'shell', kind: 'policy-runtime', why: S }],
};
const B = {
  id: 'sfixB', title: 'Fixture B: serial run', created: 1700000100000, system: S, padSeen: {},
  messages: [
    { role: 'user', content: S }, { role: 'assistant', content: S, tool_calls: [call('d1', 'ls', {})] }, tool('d1', 'ok'), { role: 'assistant', content: S },
  ],
  ledger: [
    row({ model: 'vendor/model-b', strat: 'strat-serial-1.0', prompt: 2000, cached: 0, cacheWrite: 0, completion: 100, reasoning: 0, cost: 0.0301 }),
    row({ model: 'vendor/model-b', strat: 'strat-serial-1.0', prompt: 2300, cached: 1900, cacheWrite: 0, completion: 120, reasoning: 0, cost: 0.0177 }),
    row({ model: 'vendor/model-b', strat: 'strat-serial-1.0', prompt: 2700, cached: 2200, cacheWrite: 0, completion: 90, reasoning: 0, cost: 0.0190 }),
  ],
};
const ckpt = { a1: { kind: 'system', len: 100, t: 1, session: 'sfixA', writes: 1, writeTokens: 3800, reads: 4, readTokens: 20000 }, a2: { kind: 'tail', len: 200, t: 1, session: 'sfixA', writes: 4, writeTokens: 2300, reads: 0, readTokens: 0 }, a3: { kind: 'stem', len: 300, t: 1, session: 'sfixA', writes: 1, writeTokens: 600, reads: 1, readTokens: 5000 } };
fs.writeFileSync(new URL('./metrics-sessions.json', import.meta.url), JSON.stringify({ sessions: [A, B], ckpt, sentinel: S }, null, 1) + '\n');
