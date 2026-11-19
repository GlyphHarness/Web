// Turn profile: what a session's turns looked like, from metadata only.
// Reads a stored session (messages + ledger) and reports shape, counts, sizes, repeats and costs.
// It never copies message content into its output, and it makes no judgement of good or bad:
// every row says what happened. A drill (`drill`) is the one place content is shown, on purpose and by index.
import crypto from 'node:crypto';

const num = v => Number(v) || 0;
const sum = (a, f) => a.reduce((n, e) => n + num(typeof f === 'function' ? f(e) : e[f]), 0);
const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const len = c => typeof c === 'string' ? c.length : c == null ? 0 : JSON.stringify(c).length;

// a tool result's outcome class, by its leading words only (the class name is reported, the text is not)
export function resultClass(text) {
  const t = String(text ?? '');
  if (/^Not run/.test(t)) return 'not-run';
  if (/find occurs 0 times/.test(t)) return 'find-absent';
  if (/find occurs \d+ times|must be once/.test(t)) return 'find-ambiguous';
  if (/^(Tool error|Error:)/.test(t)) return 'error';
  if (/refused|not available|not allowed|denied/i.test(t.slice(0, 200))) return 'refused';
  if (/HELD|awaiting approval|approval/i.test(t.slice(0, 120))) return 'held';
  if (!t.trim()) return 'empty';
  return 'ok';
}

// one row per (strategy, model, main|helper kind) so a session that changed model is not counted whole in each group
function slices(reqs) {
  const g = {};
  for (const r of reqs) {
    const k = (r.helper ? 'helper:' + r.helper : r.strat || '-') + ' | ' + (r.model || '-'), o = g[k] ||= { group: k, requests: 0, cost: 0, prompt: 0, cached: 0, out: 0, reasoning: 0, costs: [], firstHit: null };
    if (r.cached > 0 && o.firstHit == null) o.firstHit = o.requests;
    o.requests++; o.cost += r.cost; o.prompt += r.prompt; o.cached += r.cached; o.out += r.out; o.reasoning += r.reasoning; o.costs.push(r.cost);
  }
  return Object.values(g);
}

export function profile(s) {
  const msgs = s.messages || [], led = s.ledger || [];
  const reqs = led.map((e, i) => ({
    i, helper: e.helper ? (e.kind || 'helper') : null, strat: e.strat || null, model: e.model || null,
    prompt: num(e.prompt), cached: num(e.cached), write: num(e.cacheWrite), out: num(e.completion), reasoning: num(e.reasoning), cost: num(e.cost),
    cachePct: num(e.prompt) ? Math.round(100 * num(e.cached) / num(e.prompt)) : null,
  }));
  const main = reqs.filter(r => !r.helper), helper = reqs.filter(r => r.helper);

  // message shape
  const results = new Map(); // tool_call_id -> {class, chars}
  for (const m of msgs) if (m.role === 'tool') results.set(m.tool_call_id, { cls: resultClass(m.content), chars: len(m.content) });
  const calls = [];
  msgs.forEach((m, i) => (m.tool_calls || []).forEach(t => {
    const args = t.function?.arguments ?? '';
    const r = results.get(t.id) || { cls: 'no-result', chars: 0 };
    calls.push({ msg: i, name: t.function?.name, argHash: hash(args), argChars: len(args), cls: r.cls, resultChars: r.chars });
  }));

  // turns: a turn starts at each user message
  const turns = []; let cur = null;
  msgs.forEach((m, i) => {
    if (m.role === 'user') { cur = { start: i, userChars: len(m.content), assistantMsgs: 0, assistantChars: 0, calls: [] }; turns.push(cur); }
    else if (cur && m.role === 'assistant') { cur.assistantMsgs++; cur.assistantChars += len(m.content); }
  });
  for (const c of calls) { const t = [...turns].reverse().find(t => t.start <= c.msg); if (t) t.calls.push(c); }

  // repeats: the same tool with identical arguments again
  const seen = new Map(); let repeats = 0, repeatRuns = 0, prevRep = false;
  for (const c of calls) {
    const key = c.name + ':' + c.argHash, n = (seen.get(key) || 0) + 1; seen.set(key, n);
    const rep = n > 1; if (rep) repeats++; if (rep && !prevRep) repeatRuns++; prevRep = rep;
  }
  // order: how many calls before the first write, and how reads and writes interleave
  const READ = /read|ls|list|search|get|fetch/i, WRITE = /commit|pr$|create|file|write|edit/i;
  const firstWrite = calls.findIndex(c => WRITE.test(c.name || '') && !READ.test(c.name || ''));
  const byClass = {}; for (const c of calls) byClass[c.cls] = (byClass[c.cls] || 0) + 1;
  const byTool = {}; for (const c of calls) byTool[c.name] = (byTool[c.name] || 0) + 1;

  // growth: prompt tokens per request and the cache curve
  const promptCurve = main.map(r => r.prompt), cacheCurve = main.map(r => r.cachePct);
  const firstHit = main.findIndex(r => r.cached > 0);

  return {
    id: s.id, title: s.title,
    models: [...new Set(main.map(r => r.model).filter(Boolean))], strategies: [...new Set(main.map(r => r.strat).filter(Boolean))],
    slices: slices(reqs),
    messages: msgs.length, turns: turns.length,
    requests: { main: main.length, helper: helper.length, helperKinds: helper.reduce((o, r) => (o[r.helper] = (o[r.helper] || 0) + 1, o), {}) },
    tokens: { prompt: sum(main, 'prompt'), cached: sum(main, 'cached'), write: sum(main, 'write'), out: sum(main, 'out'), reasoning: sum(main, 'reasoning') },
    cost: { total: sum(reqs, 'cost'), main: sum(main, 'cost'), helper: sum(helper, 'cost'), perRequestMedian: med(main.map(r => r.cost)), helperMax: helper.length ? Math.max(...helper.map(r => r.cost)) : 0 },
    cache: { overallPct: sum(main, 'prompt') ? Math.round(100 * sum(main, 'cached') / sum(main, 'prompt')) : null, firstHitAtRequest: firstHit < 0 ? null : firstHit, curve: cacheCurve },
    growth: { promptCurve, outCurve: main.map(r => r.out), reasoningShare: sum(main, 'out') ? +(sum(main, 'reasoning') / sum(main, 'out')).toFixed(2) : 0 },
    calls: { total: calls.length, byTool, byResultClass: byClass, repeats, repeatRuns, callsBeforeFirstWrite: firstWrite < 0 ? null : firstWrite, firstWriteTool: firstWrite < 0 ? null : calls[firstWrite].name },
    perTurn: turns.map((t, n) => ({ n, userChars: t.userChars, shortFollowUp: n > 0 && t.userChars < 240, assistantMsgs: t.assistantMsgs, calls: t.calls.length, tools: t.calls.map(c => c.name + (c.cls === 'ok' ? '' : ':' + c.cls)).join(' ') })),
    flags: (s.flags || []).reduce((o, f) => (o[f.tool + ':' + String(f.kind || f.why || '').slice(0, 30)] = (o[f.tool + ':' + String(f.kind || f.why || '').slice(0, 30)] || 0) + 1, o), {}),
    stem: s.stem ? { folded: !!s.stem.folded } : null,
  };
}

// across sessions: group by (strategy | model); helper requests by (helper:kind | model). Spread, not a winner.
export function across(profiles) {
  const g = {};
  for (const p of profiles) for (const sl of p.slices) (g[sl.group] ||= []).push(sl);
  return Object.entries(g).map(([group, sls]) => {
    const all = sls.flatMap(x => x.costs), sorted = [...all].sort((x, y) => x - y);
    return {
      group, sessions: sls.length, requests: sum(sls, 'requests'), costTotal: sum(sls, 'cost'),
      costMedian: med(all), costP95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null, costMax: sorted.length ? sorted[sorted.length - 1] : null,
      cachePct: sum(sls, 'prompt') ? Math.round(100 * sum(sls, 'cached') / sum(sls, 'prompt')) : null, firstHitAtRequest: med(sls.map(x => x.firstHit).filter(x => x != null)),
      outPerRequest: sum(sls, 'requests') ? sum(sls, 'out') / sum(sls, 'requests') : null, reasoningShare: sum(sls, 'out') ? +(sum(sls, 'reasoning') / sum(sls, 'out')).toFixed(2) : null,
    };
  });
}
// per-session behaviour counts (not tied to one model slice)
export function behaviour(profiles) {
  return profiles.map(p => ({ id: p.id, title: p.title, models: p.models, repeats: p.calls.repeats, callsBeforeFirstWrite: p.calls.callsBeforeFirstWrite, failedShare: p.calls.total ? +((p.calls.total - (p.calls.byResultClass.ok || 0)) / p.calls.total).toFixed(2) : null, shortFollowUps: p.perTurn.filter(t => t.shortFollowUp).length, helperShareOfCost: p.cost.total ? +(p.cost.helper / p.cost.total).toFixed(2) : null }));
}

const k = n => n == null ? '-' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
const $ = n => '$' + (Number(n) || 0).toFixed(5);
export function render(p) {
  return [
    `${p.id}  ${p.title}`,
    `  ${p.models.join(',') || '-'} · ${p.strategies.join(',') || '-'} · ${p.turns} turns · ${p.requests.main} req (+${p.requests.helper} helper ${JSON.stringify(p.requests.helperKinds)}) · ${$(p.cost.total)} (helper ${$(p.cost.helper)}, helper max ${$(p.cost.helperMax)})`,
    `  tokens ${k(p.tokens.prompt)} in · ${p.cache.overallPct ?? '-'}% cached · first hit at request ${p.cache.firstHitAtRequest ?? 'never'} · ${k(p.tokens.write)} written · ${k(p.tokens.out)} out (${Math.round(p.growth.reasoningShare * 100)}% reasoning)`,
    `  prompt per request ${p.growth.promptCurve.map(k).join(' ')}`,
    `  out per request    ${p.growth.outCurve.map(k).join(' ')}`,
    `  cache % per request ${p.cache.curve.map(x => x ?? '-').join(' ')}`,
    `  calls ${p.calls.total}: ${Object.entries(p.calls.byTool).map(([a, b]) => a + '×' + b).join(' ')} | results ${Object.entries(p.calls.byResultClass).map(([a, b]) => a + '×' + b).join(' ')}`,
    `  repeated identical calls ${p.calls.repeats} in ${p.calls.repeatRuns} runs · calls before first write ${p.calls.callsBeforeFirstWrite ?? 'no write'}${p.calls.firstWriteTool ? ' (' + p.calls.firstWriteTool + ')' : ''}`,
    ...p.perTurn.map(t => `  turn ${t.n}: user ${t.userChars}ch${t.shortFollowUp ? ' (short follow-up)' : ''}, ${t.assistantMsgs} assistant msgs, ${t.calls} calls ${t.tools ? '[' + t.tools + ']' : ''}`),
    Object.keys(p.flags).length ? '  flags ' + JSON.stringify(p.flags) : '',
  ].filter(Boolean).join('\n');
}
export function renderAcross(rows) {
  return rows.map(r => `${r.group}\n  ${r.sessions} sessions · ${r.requests} req · ${$(r.costTotal)} · cost/req median ${$(r.costMedian)} p95 ${$(r.costP95)} max ${$(r.costMax)} · cache ${r.cachePct ?? '-'}% (first hit at req ${r.firstHitAtRequest ?? '-'}) · out/req ${k(r.outPerRequest)} · reasoning ${Math.round((r.reasoningShare || 0) * 100)}%`).join('\n');
}
export function renderBehaviour(rows) {
  return rows.map(r => `${r.id} ${String(r.title).slice(0, 30).padEnd(30)} repeats ${r.repeats} · calls before first write ${r.callsBeforeFirstWrite ?? '-'} · failed share ${r.failedShare ?? '-'} · short follow-ups ${r.shortFollowUps} · helper share of cost ${r.helperShareOfCost ?? '-'}`).join('\n');
}

// the one place content appears: a message or a request, by index, truncated
export function drill(s, { msg, req, chars = 1200 }) {
  if (msg != null) { const m = s.messages?.[msg]; if (!m) return `no message ${msg}`; return JSON.stringify({ role: m.role, tool_calls: (m.tool_calls || []).map(t => ({ name: t.function?.name, args: String(t.function?.arguments ?? '').slice(0, chars) })), content: String(m.content ?? '').slice(0, chars), contentChars: len(m.content) }, null, 1); }
  if (req != null) { const e = s.ledger?.[req]; return e ? JSON.stringify(e, null, 1).slice(0, chars * 2) : `no request ${req}`; }
  return 'give msg or req';
}
