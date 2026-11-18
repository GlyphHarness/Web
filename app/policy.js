// Tool-call policies with repair. Before a call runs, each policy whose tool and
// pattern match its arguments is checked. A match does not just block: a cheap
// model (the policy model, else the helper, else the session's model) gets a
// small, fixed context (the policy, the tool's schema, the call) and returns
// corrected arguments. The corrected call is checked again and runs instead; the
// log keeps it, and the original is kept beside it as evidence. No repair, or a
// repair that still breaks the policy, means the call does not run.
//
// Policy text, one per line:   <tool|*> /<regex>/<flags> <rule in plain words>
// Lines starting with # are comments.

export const DEFAULT_POLICIES = `# <tool|*> /<regex>/<flags> <rule>   (checked against the call's arguments as JSON)
shell /\\bsleep\\s+([2-9]\\d|\\d{3,})\\b/ Do not pause with a long fixed sleep. Wait on the condition itself: an until-loop that checks it every few seconds, with an overall limit (for example: until <check> || [ $SECONDS -gt 300 ]; do sleep 3; done).`;

export function parse(text) {
  const out = [];
  for (const [i, raw] of String(text || '').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(\S+)\s+\/((?:\\.|[^/])+)\/([a-z]*)\s+(.+)$/.exec(line);
    if (!m) { out.push({ id: 'p' + (i + 1), error: 'cannot read: ' + line.slice(0, 80) }); continue; }
    try { out.push({ id: 'p' + (i + 1), tool: m[1], re: new RegExp(m[2], m[3]), rule: m[4] }); }
    catch (e) { out.push({ id: 'p' + (i + 1), error: e.message }); }
  }
  return out;
}

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
