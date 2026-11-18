// Request assembly and prefix-cache accounting.
//
// The session log is append-only and is sent exactly as stored, so each request
// is the previous request plus a tail. That is what upstream prefix caches need.
// Anything that breaks it (editing the system prompt, changing tools, switching
// model) shows up in the ledger as a short "kept" prefix.

export function buildRequest(session, model, toolDefs) {
  const messages = [];
  if (session.system) messages.push({ role: 'system', content: session.system });
  for (const m of session.messages) {
    const { x, ...wire } = m; // x = local-only metadata, never sent
    messages.push(wire);
  }
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
  return {
    t: Date.now(), model: body.model, chars: cur.length,
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
    out.push(`<scratchpad label=${JSON.stringify(p.label)}>\n${p.text}\n</scratchpad>`);
  }
  return out.length ? '\n\n' + out.join('\n\n') : '';
}
