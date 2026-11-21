// Query surface, bounded live probe (rigid order step 5). docs/QUERY.md OQ1, OQ2, OQ9.
// One cheap model (qwen/qwen3.7-flash, the cheapest the repo already uses) gets the surface preface (surface.synopsis()) plus two mock tools,
// query(q, variables?) and query_ref(ref, op, name?, value?, why?), executed by the real surface in this process over scripts/measure-query-fixtures.mjs.
// Eight tasks of the shape of real work on this repo's records; ground truth is computed here from the same data, independent of the surface.
// Key: OPENROUTER_API_KEY from C:\wh\secrets.env, read inside this process, never printed, logged or written; headers are never stored.
// Usage: node scripts/probe-query.mjs [--only T1,T2] [--skip T1] [--date YYYY-MM-DD]. Max 40 requests in total (counted from the jsonl file). No model call in tests.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, J, tok, hash, CAT, SESSIONS, TRAIL, slong, mk } from './measure-query-fixtures.mjs';

const MODEL = 'qwen/qwen3.7-flash', MAX_REQUESTS = 40, PER_TASK = 5, MAX_TOKENS = 1500;
const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const DATE = arg('--date') || new Date().toISOString().slice(0, 10), ONLY = arg('--only')?.split(','), SKIP = (arg('--skip') || '').split(',').filter(Boolean);
const OUT = path.join(ROOT, 'docs/concepts/results', `query-probe-${DATE}.jsonl`);

// --summarize: read the jsonl, write the .md table and print the headline numbers; no key needed, no request
if (process.argv.includes('--summarize')) {
  const L = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.kind !== 'summary'), T = L.filter(l => l.kind === 'task'), R = L.filter(l => l.kind === 'request');
  const sum = k => T.reduce((a, t) => a + (t[k] || 0), 0), q = sum('queries'), rf = sum('refs'), pv = sum('parseValidateFail');
  const laterQ = T.reduce((a, t) => a + Math.max(0, t.queries - 2), 0);
  const o = { model: MODEL, tasks: T.length, requests: R.length, completed: T.filter(t => t.completed).length, queries: q, parseValidateFail: pv, parseValidateFailRate: +(pv / q).toFixed(3), firstQueryFailed: T.filter(t => t.firstQueryFailed).length, laterQueries: laterQ, laterQueryParseValidateFail: T.reduce((a, t) => a + t.queryFails.slice(2).filter(c => !c.startsWith('exec:')).length, 0), refs: rf, misRef: sum('misRef'), misRefRate: rf ? +(sum('misRef') / rf).toFixed(3) : null, reruns: sum('reruns'), roundTrips: sum('requests'), promptTokens: sum('promptTokens'), completionTokens: sum('completionTokens'), reasoningTokens: sum('reasoningTokens'), cost: +sum('cost').toFixed(5), tokensPerTask: Math.round((sum('promptTokens') + sum('completionTokens')) / T.length), codes: T.flatMap(t => t.queryFails).reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {}) };
  fs.appendFileSync(OUT, J({ kind: 'summary', ...o }) + '\n');
  const md = ['# Query surface: live probe (' + DATE + ')', '', 'Model ' + MODEL + ' via OpenRouter, ' + o.requests + ' requests (cap ' + MAX_REQUESTS + ', ' + PER_TASK + ' per task), 8 tasks, n = 1 run per task: a smoke-level probe, not a rate estimate. Raw: query-probe-' + DATE + '.jsonl. A first canary series (T2, with the synthetic scratch adapter in the schema, 4 requests) is in query-probe-canary-scratch-' + DATE + '.jsonl and is not counted in these numbers.', '', '| task | completed | requests | queries | parse/validate fails | refs | ref refusals | reruns | prompt tok | completion tok | ended |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...T.map(t => '| ' + [t.id, t.completed, t.requests, t.queries, t.parseValidateFail + (t.queryFails.length ? ' (' + t.queryFails.join(',') + ')' : ''), t.refs, t.refFails.join(',') || '-', t.reruns, t.promptTokens, t.completionTokens, t.ended].join(' | ') + ' |'), '', '`' + J(o) + '`', ''];
  fs.writeFileSync(OUT.replace('.jsonl', '.md'), md.join('\n'));
  console.log(J(o, null, 1)); process.exit(0);
}

// key: only the OpenRouter variable line, only inside this process
let KEY = null;
try { const m = /^OPENROUTER_API_KEY\s*=\s*(.+)$/m.exec(fs.readFileSync('C:\\wh\\secrets.env', 'utf8')); if (m) KEY = m[1].trim().replace(/^["']|["']$/g, ''); } catch {}
if (!KEY) { console.log('SKIPPED: no OPENROUTER_API_KEY line in C:\\wh\\secrets.env (or the file is unreadable); no request made.'); process.exit(0); }

// ground truth, from the data and independent of the surface
const cur = a => { const n = new Set(a.map(c => c.supersedes).filter(Boolean)); return a.filter(c => !n.has(c.id)); };
const sfixA = SESSIONS.find(s => s.id === 'sfixA'), txt = m => (typeof m.content === 'string' ? m.content : J(m.content));
const bigTurn = slong.messages.map((m, i) => [i, txt(m).length]).sort((a, b) => b[1] - a[1])[0][0];
const TASKS = [
  { id: 'T1', ask: 'List the ids of the concept records whose status is "hypothesis" and whose name or claim mentions the word "handle" (case-insensitive). Current records only (not superseded ones).', form: '{"ids":["..."]}',
    truth: cur(CAT.concepts).filter(c => c.status === 'hypothesis' && /handle/i.test(c.name + ' ' + c.claim)).map(c => c.id), grade: (a, t) => setEq(a.ids, t) },
  { id: 'T2', ask: 'Give the exact text of the turn with i = 2 in session sfixA.', form: '{"text":"..."}', truth: txt(sfixA.messages[2]), grade: (a, t) => a.text === t },
  { id: 'T3', ask: 'In session sfixA, which tool-result turn was held (reads "Not run") rather than failed with an error? Give its turn index i.', form: '{"i":N}', truth: sfixA.messages.findIndex(m => m.role === 'tool' && /^Not run/.test(txt(m))), grade: (a, t) => a.i === t },
  { id: 'T4', ask: 'Which ledger rows of session slong had a cacheWrite above 0? Give their n values.', form: '{"n":[...]}', truth: null, grade: null }, // set just below (needs setEq)
  { id: 'T5', ask: 'List the ids of the faults of class "common" recorded for model qwen/qwen3.7-flash (current records only).', form: '{"ids":["..."]}',
    truth: cur(CAT.faults).filter(f => f.class === 'common' && f.model === 'qwen/qwen3.7-flash').map(f => f.id), grade: (a, t) => setEq(a.ids, t) },
  { id: 'T6', ask: 'What are the kind and the owner of handle ab3dd9, and which readers does its audit show?', form: '{"kind":"...","owner":"...","readers":["..."]}', truth: { kind: 'checkpoint', owner: 'slong', readers: ['slong'] }, grade: (a, t) => a.kind === t.kind && a.owner === t.owner && setEq(a.readers, t.readers) },
  { id: 'T7', ask: 'In the tool trail, which rows failed (ok is false) and carry a why note? Give n and tool of each.', form: '{"rows":[{"n":N,"tool":"..."}]}',
    truth: TRAIL.map((r, i) => ({ ...r, n: i + 1 })).filter(r => !r.ok && r.why).map(r => ({ n: r.n, tool: r.tool })), grade: (a, t) => setEq((a.rows || []).map(r => r.n + ':' + r.tool), t.map(r => r.n + ':' + r.tool)) },
  { id: 'T8', ask: 'In session slong, which turn has the most characters? Give its index i and the first 40 characters of its text.', form: '{"i":N,"start":"..."}', truth: { i: bigTurn, start: txt(slong.messages[bigTurn]).slice(0, 40) }, grade: (a, t) => a.i === t.i && typeof a.start === 'string' && a.start.slice(0, 40) === t.start },
];
// T4 truth: computed properly (kept apart so the placeholder above is not used)
{ const t4 = TASKS.find(t => t.id === 'T4'); t4.truth = slong.ledger.map((r, i) => [i + 1, r.cacheWrite]).filter(x => x[1] > 0).map(x => x[0]); t4.grade = (a, t) => setEq(a.n, t); }
function setEq(a, b) { return Array.isArray(a) && new Set(a.map(String)).size === new Set(b.map(String)).size && b.every(x => a.map(String).includes(String(x))); }

const TOOLS = [
  { type: 'function', function: { name: 'query', description: 'Run one query text of the surface described in the system message. Returns {header, data, errors?}.', parameters: { type: 'object', properties: { q: { type: 'string', description: 'the query text' }, variables: { type: 'object' } }, required: ['q'] } } },
  { type: 'function', function: { name: 'query_ref', description: 'Act on one label of an earlier query result: ref is "<q>/<label>" (for example q1/t0); op is get (the payload), property (needs name) or set (needs name and value). Returns {header, data, errors?}.', parameters: { type: 'object', properties: { ref: { type: 'string' }, op: { type: 'string', enum: ['get', 'property', 'set'] }, name: { type: 'string' }, value: {}, why: { type: 'string' } }, required: ['ref', 'op'] } } },
];

const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const CANARY = path.join(ROOT, 'docs/concepts/results', 'query-probe-canary-scratch-' + DATE + '.jsonl'); // first canary run (T2) with the scratch adapter in the schema; kept, counted against the budget, not a result
let used = existing.filter(r => r.kind === 'request').length + (fs.existsSync(CANARY) ? fs.readFileSync(CANARY, 'utf8').split('\n').filter(l => l.includes('"kind":"request"')).length : 0);
console.log(`model ${MODEL}; requests already used: ${used}/${MAX_REQUESTS}`);
const append = o => fs.appendFileSync(OUT, J(o) + '\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

async function call(messages) {
  const body = { model: MODEL, messages, tools: TOOLS, max_tokens: MAX_TOKENS, temperature: 0, reasoning: { effort: 'low' }, usage: { include: true } };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY }, body: J(body) });
  const status = res.status, text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { body, status, json, text };
}

const results = [];
for (const task of TASKS) {
  if ((ONLY && !ONLY.includes(task.id)) || SKIP.includes(task.id)) continue;
  const m = mk({ harnessOnly: true }); const S = m.S;
  const system = S.synopsis() + '\n\nTools: query(q, variables?) runs one query; query_ref(ref, op, name?, value?, why?) acts on a label of an earlier result. Answer from the data only. Finish with one line: ANSWER: <json>.';
  const messages = [{ role: 'system', content: system }, { role: 'user', content: `${task.ask}\nFinish with: ANSWER: ${task.form}` }];
  const t = { id: task.id, requests: 0, queries: 0, refs: 0, parseValidateFail: 0, queryFails: [], refFails: [], misRef: 0, reruns: 0, firstQueryFailed: null, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0, completed: false, answerParsed: false, answer: null, truth: task.truth, ended: null };
  const seen = new Set(), roots = new Set();
  for (let step = 0; step < PER_TASK; step++) {
    if (used >= MAX_REQUESTS) { t.ended = 'budget'; break; }
    used++; t.requests++;
    const r = await call(messages);
    append({ kind: 'request', task: task.id, n: t.requests, status: r.status, request: { model: r.body.model, max_tokens: r.body.max_tokens, messages: r.body.messages.map(x => (x.role === 'system' ? { role: 'system', content: '[surface.synopsis() + tool note, ' + x.content.length + ' chars, hash ' + hash(x.content) + ']' } : x)), tools: '[query, query_ref]' }, response: r.json ?? r.text.slice(0, 500) });
    if (!r.json || r.json.error || !r.json.choices?.[0]) { t.ended = 'api-error ' + r.status; break; }
    const u = r.json.usage || {}; t.promptTokens += u.prompt_tokens || 0; t.completionTokens += u.completion_tokens || 0; t.reasoningTokens += u.completion_tokens_details?.reasoning_tokens || 0; t.cost += u.cost || 0;
    const msg = r.json.choices[0].message; messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) {
      const mm = /ANSWER:\s*(\{[\s\S]*\})/.exec(msg.content || '');
      if (mm) { t.answerParsed = true; try { t.answer = JSON.parse(mm[1]); t.completed = !!task.grade(t.answer, task.truth); } catch { t.answerParsed = false; } }
      t.ended = 'answered'; break;
    }
    for (const c of msg.tool_calls) {
      let a = {}, out;
      try { a = JSON.parse(c.function.arguments || '{}'); } catch { out = { header: { ok: false }, errors: [{ message: 'arguments are not JSON', extensions: { code: 'ARGS', stage: 'parse' } }] }; }
      if (!out && c.function.name === 'query') {
        t.queries++;
        const norm = String(a.q || '').replace(/\s+/g, ' ').trim(), root = (/\{\s*(?:\w+\s*:\s*)?(\w+\s*(?:\([^)]*\))?)/.exec(norm) || [])[1];
        if (seen.has(norm) || (root && roots.has(root))) t.reruns++; seen.add(norm); if (root) roots.add(root);
        out = await S.run(String(a.q || ''), { variables: a.variables && typeof a.variables === 'object' ? a.variables : undefined });
        const failStage = out.errors?.find(e => ['parse', 'validate'].includes(e.extensions.stage));
        if (t.firstQueryFailed === null) t.firstQueryFailed = !!failStage;
        if (failStage) { t.parseValidateFail++; t.queryFails.push(out.errors.map(e => e.extensions.code).join('+')); }
        else if (out.errors) t.queryFails.push('exec:' + out.errors.map(e => e.extensions.code).join('+'));
      } else if (!out && c.function.name === 'query_ref') {
        t.refs++;
        out = await S.ref(String(a.ref || ''), { op: a.op, name: a.name, value: a.value, why: a.why });
        if (out.errors) { const code = out.errors[0].extensions.code; t.refFails.push(code); if (['REF_FORMAT', 'REF_UNKNOWN_QUERY', 'REF_UNKNOWN_LABEL'].includes(code)) t.misRef++; }
      } else if (!out) out = { header: { ok: false }, errors: [{ message: 'unknown tool ' + c.function.name, extensions: { code: 'TOOL', stage: 'parse' } }] };
      messages.push({ role: 'tool', tool_call_id: c.id, content: J(out) });
    }
    if (step === PER_TASK - 1) t.ended = 'request cap per task';
  }
  t.cost = Number(t.cost.toFixed(6)); results.push(t); append({ kind: 'task', ...t });
  console.log(`${t.id}: completed=${t.completed} requests=${t.requests} queries=${t.queries} refs=${t.refs} fails=${t.parseValidateFail} ended=${t.ended} ptok=${t.promptTokens} ctok=${t.completionTokens}`);
}
console.log(`requests used: ${used}/${MAX_REQUESTS}`);
