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
  const system = [session.system, session.keep ? KEEP_NOTE : ''].filter(Boolean).join('\n\n');
  if (system) messages.push({ role: 'system', content: system });
  const log = session.messages.map(({ x, ...wire }) => wire); // x = local-only metadata, never sent
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
