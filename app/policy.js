// Tool-call policies with repair. Before a call runs, each policy whose tool and
// pattern match its arguments is checked. A match does not just block: a cheap
// model (the policy model, else the helper, else the session's model) gets a
// small, fixed context (the policy, the tool's schema, the call) and returns
// corrected arguments. The corrected call is checked again and runs instead; the
// log keeps it, and the original is kept beside it as evidence. No repair, or a
// repair that still breaks the policy, means the call does not run.
//
// A policy is a named item: {name, tool ('*' for any), pattern (regex source),
// flags, rule (plain words), on}. Smells and the thread refer to it by name.

export const DEFAULT_LIST = [{
  name: 'bounded-waits', tool: 'shell', pattern: '\\bsleep\\s+([2-9]\\d|\\d{3,})\\b', flags: '', on: true,
  rule: 'Do not pause with a long fixed sleep. Wait on the condition itself: an until-loop that checks it every few seconds, with an overall limit (for example: until <check> || [ $SECONDS -gt 300 ]; do sleep 3; done).',
}];

// The earlier one-line text form, "<tool|*> /<regex>/<flags> <rule>", converted once.
export function fromText(text) {
  const out = [];
  for (const [i, raw] of String(text || '').split('\n').entries()) {
    const m = /^(\S+)\s+\/((?:\\.|[^/])+)\/([a-z]*)\s+(.+)$/.exec(raw.trim());
    if (m && !raw.trim().startsWith('#')) out.push({ name: 'p' + (i + 1), tool: m[1], pattern: m[2], flags: m[3], rule: m[4], on: true });
  }
  return out;
}

// Ready to match: {id: name, tool, re, rule}; a bad pattern gives {id, error}.
export function compile(list) {
  return (list || []).filter(p => p.on !== false).map(p => {
    if (!p.pattern || !p.rule) return { id: p.name, error: 'needs a pattern and a rule' };
    try { return { id: p.name, tool: p.tool || '*', re: new RegExp(p.pattern, p.flags || ''), rule: p.rule }; }
    catch (e) { return { id: p.name, error: e.message }; }
  });
}
export const parse = text => compile(fromText(text)); // kept for the text form

export const broken = (policies, name, args) => policies.filter(p => !p.error && (p.tool === '*' || p.tool === name) && p.re.test(args));

export const FIX_SYSTEM = 'You repair one tool call so that it follows a policy. Reply with JSON only: {"arguments": {...}} for the corrected call to the same tool, or {"refuse": "<one line>"} when it cannot be done within the policy. Keep everything the policy does not forbid exactly as it was.';

export const fixPrompt = (p, name, schema, args) => `POLICY: ${p.rule}\nTOOL: ${name}\nSCHEMA: ${JSON.stringify(schema)}\nCALL: ${args}`;

export function readFix(text) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(s.slice(a, b + 1));
    if (j && typeof j.refuse === 'string') return { refuse: j.refuse.slice(0, 300) };
    if (j && j.arguments && typeof j.arguments === 'object') return { arguments: j.arguments };
  } catch {}
  return null;
}
