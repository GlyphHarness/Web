// Request assembly and prefix-cache accounting.
//
// The session log is append-only and is sent exactly as stored, so each request
// is the previous request plus a tail. That is what upstream prefix caches need.
// Anything that breaks it (editing the system prompt, changing tools, switching
// model) shows up in the ledger as a short "kept" prefix.

// The stored log is always structured (tool_calls and tool results). How it is
// put on the wire is a per-session choice, session.wire:
//   'calls'  as stored.
//   'notes'  each call becomes one line in the assistant's own turn, e.g.
//            [called run_js "sum rows" os:1k2j3h want: total]
//            and each result becomes a [result ...] block in the next user turn.
//            No call ids, no argument JSON, and the stated want sits in the
//            cached prefix right before its result.
// Both are pure functions of the log, so either keeps the prefix byte-stable.
// Changing the choice mid-session rewrites the prefix once.

function callNote(tc) {
  let a = {};
  try { a = JSON.parse(tc.function.arguments); } catch {}
  const { ref, name, want, ...rest } = a;
  const args = ref ? ' ' + ref : Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
  return `[called ${tc.function.name}${name ? ` ${JSON.stringify(name)}` : ''}${args}${want ? ` want: ${want}` : ''}]`;
}

function asNotes(log) {
  const out = [], label = {};
  const add = (role, content) => { const p = out.at(-1); p && p.role === role ? p.content += '\n\n' + content : out.push({ role, content }); };
  for (const m of log) {
    if (m.role === 'tool') add('user', `[result ${label[m.tool_call_id] || 'call'}]\n${m.content}`);
    else if (m.tool_calls) {
      for (const tc of m.tool_calls) { let a = {}; try { a = JSON.parse(tc.function.arguments); } catch {} label[tc.id] = tc.function.name + (a.name ? ` ${JSON.stringify(a.name)}` : ''); }
      add('assistant', [m.content, ...m.tool_calls.map(callNote)].filter(Boolean).join('\n'));
    } else add(m.role, m.content || '');
  }
  return out;
}

// A reply that writes a call note instead of making the call did nothing. Detected, never executed.
export const imitatesNote = text => /^\[called \w+/m.test(text || '');

// Keep marks: the model flags a line worth keeping by starting it with "!"
// ("!!" for critical). One character per kept line, no wrappers. Nothing is cut
// mid-session (that would break the cached prefix); the marks are read when the
// session is folded, and the pocket is assembled from them without a model call.
export const KEEP_NOTE = 'Start a line with ! if it must survive when this conversation is condensed, !! if it is critical. Unmarked lines may be dropped.';

// Core prompt: the harness's own conventions, sent before the user's system
// prompt in sessions created with session.core set. It is fixed text chosen by
// the session's settings, so it sits at the very front of the cached prefix.
// Its job is to say plainly which text is the model's to write and which is the
// system's record, so an abbreviated past call is never mistaken for a way to call.
export function corePrompt(session) {
  const past = session.wire === 'notes'
    ? 'Your earlier tool calls are shown as lines like [called run_js "name" os:1k2j3h want: ...], each followed by a [result ...] block.'
    : 'Your earlier tool calls may be shown with their arguments replaced by {ref, name, want}.';
  return [
    'Conventions of this environment:',
    '- To use a tool, make a real tool call with complete arguments, every time.',
    `- ${past} These are records the system writes after the fact. Never write one yourself: it runs nothing.`,
    '- When a tool\'s output may be long, state in `want` what you are looking for. A result that starts with a tag like [os:1k2j3h 305L keywords 1/1] was reduced to that; the rest is available from output_read with the handle.',
    session.core >= 2 && session.edge && session.edge !== 'off'
      ? '- An earlier reply of yours may appear as a condensed record: a line like [os:1k2j3h troubleshot] (handle, then what that turn did) followed by the lines that were kept. entry_read opens its gotchas, steps, transcript or summary. Open one only for a specific reason the kept lines cannot meet.'
      : '',
    session.keep ? '- ' + KEEP_NOTE : '',
  ].filter(Boolean).join('\n');
}

// Edge: messages the model has not been sent back yet. A reply at the edge can be
// condensed for free: it has never been part of a cached prefix, so the short
// form is what gets cached. Once sent, a message's wire form never changes.
export const EDGE_MIN = 600; // chars; shorter replies are not worth condensing
export const markedOnly = text => text.split('\n').filter(l => /^!!?\s*\S/.test(l)).join('\n');
export const edgeReplies = s => s.messages.map((m, i) => ({ m, i }))
  .filter(({ m, i }) => i >= (s.sent || 0) && m.role === 'assistant' && !m.tool_calls && (m.content || '').length > EDGE_MIN && m.x?.wire == null);

// What a turn did, read off its log: the messages after the last user message up
// to the reply at index i. Used to label a condensed record and to fill its parts.
const FAILED = /^(Error:|Tool error|Unknown tool|Invalid JSON|No stored|Timed out)/;
export function turnOf(s, i) {
  let from = i;
  while (from > 0 && s.messages[from - 1].role !== 'user') from--;
  const results = Object.fromEntries(s.messages.slice(from, i).filter(m => m.role === 'tool').map(m => [m.tool_call_id, m.content]));
  const steps = s.messages.slice(from, i).flatMap(m => m.tool_calls || []).map(tc => {
    let a = {};
    try { a = JSON.parse(tc.function.arguments); } catch {}
    const out = String(results[tc.id] ?? '');
    return { tool: tc.function.name, name: a.name, want: a.want, ref: a.ref, ok: !FAILED.test(out), out: (/os:[a-z0-9]{6,12}/.exec(out) || [])[0], first: out.split('\n')[0].slice(0, 200) };
  });
  const looked = new Set(['output_read', 'pattern_find', 'pattern_get', 'branch_read', 'entry_read']);
  const kind = steps.some(x => !x.ok) ? 'troubleshot'
    : steps.length && steps.every(x => looked.has(x.tool)) ? 'searched'
    : steps.length ? 'built'
    : /^!!?\s*\S/m.test(s.messages[i].content || '') ? 'decided' : 'answered';
  return { kind, steps, gotchas: steps.filter(x => !x.ok).map(x => `${x.tool}${x.name ? ` "${x.name}"` : ''}: ${x.first}`) };
}
export const KINDS = ['searched', 'verified', 'troubleshot', 'built', 'decided', 'answered'];

export function keptLines(session, max = 30) {
  const hits = [];
  session.messages.forEach((m, i) => {
    if (m.role !== 'assistant' || !m.content) return;
    for (const l of m.content.split('\n')) { const k = /^(!!?)\s*(\S.*)$/.exec(l); if (k) hits.push({ p: k[1].length, i, text: k[2] }); }
  });
  // critical first, then order of encounter; the cap drops the newest ordinary lines last
  return hits.sort((a, b) => b.p - a.p || a.i - b.i).slice(0, max).map(h => h.text);
}

export function buildRequest(session, model, toolDefs) {
  const messages = [];
  // sessions from before the core prompt keep their old prefix (system, then the keep note)
  const system = (session.core ? [corePrompt(session), session.system] : [session.system, session.keep ? KEEP_NOTE : '']).filter(Boolean).join('\n\n');
  if (system) messages.push({ role: 'system', content: system });
  // x = local-only metadata, never sent. x.wire, when set, is the condensed text
  // that goes out in place of the message's content (see edge folding in main.js).
  const log = session.messages.map(({ x, ...wire }) => x?.wire != null ? { ...wire, content: x.wire } : wire);
  messages.push(...(session.wire === 'notes' ? asNotes(log) : log));
  const body = { model, messages, stream: true };
  if (toolDefs.length) body.tools = toolDefs;
  return body;
}

// Flattened in cache order: tools, then one line per message.
export const flatten = body =>
  [body.model, JSON.stringify(body.tools || []), ...body.messages.map(m => JSON.stringify(m))].join('\n');

const last = new Map(); // sessionId -> flattened previous request (memory only)

// Call before sending. Returns the local half of a ledger entry.
export function measure(sessionId, body) {
  const cur = flatten(body);
  const prev = last.get(sessionId);
  last.set(sessionId, cur);
  let kept = 0;
  if (prev) while (kept < prev.length && kept < cur.length && prev.charCodeAt(kept) === cur.charCodeAt(kept)) kept++;
  // Name the first block that differs: line 0 is the model, 1 the tools, then one line per message.
  let broke = null;
  if (prev && kept < prev.length) {
    const line = cur.slice(0, kept).split('\n').length - 1;
    broke = line === 0 ? 'model' : line === 1 ? 'tools' : 'message ' + (line - 2);
  }
  return {
    t: Date.now(), model: body.model, chars: cur.length, broke,
    // null = no earlier request in this page load to compare against
    kept: prev ? kept : null, prevChars: prev ? prev.length : null,
  };
}

// Call with the provider's usage object. Adds the reported half.
export function report(entry, usage) {
  if (!usage) return entry;
  const d = usage.prompt_tokens_details || {};
  entry.prompt = usage.prompt_tokens ?? null;
  entry.cached = d.cached_tokens ?? null;
  entry.cacheWrite = d.cache_write_tokens ?? null;
  entry.completion = usage.completion_tokens ?? null;
  entry.cost = usage.cost ?? null;
  return entry;
}

// A branch starts as its source's last request plus a tail, so it is measured against that.
export const inherit = (childId, parentId) => { if (last.has(parentId)) last.set(childId, last.get(parentId)); };

const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

// Scratchpads marked "include" ride on the user message that is being sent, and
// only when new or changed since this session last saw them. They become part of
// the stored message, so the prefix stays byte-stable afterwards.
export function padAttachment(session, pads) {
  session.padSeen ??= {};
  const out = [];
  for (const p of pads) {
    if (!p.include || !p.text) continue;
    const sig = hash(p.label + '\n' + p.text);
    if (session.padSeen[p.id] === sig) continue;
    session.padSeen[p.id] = sig;
    out.push(`pad ${p.label}:\n${p.text}`);
  }
  return out.length ? '\n\n' + out.join('\n\n') : '';
}
