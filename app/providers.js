// Pluggable providers. A provider is:
//   { label, needsKey, models(key) -> [{id, name}], stream(body, key, signal) -> async iterator of chunks }
// Chunks are OpenAI-style streaming objects ({choices:[{delta}], usage, error}).

async function* sse(res, onRaw) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = dec.decode(value, { stream: true });
    onRaw?.(text);
    buf += text;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue; // blank lines and ": comment" keep-alives
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); } catch { /* partial or non-JSON line */ }
    }
  }
}

// opt.base overrides the API root (a proxy, another OpenAI-compatible host, or
// the local replay server). opt.trace is an array that receives one record per
// request: the body sent, the status, and the raw response text in the chunks
// it arrived in with millisecond offsets. The API key is never recorded.
function openaiCompatible({ label, base }) {
  const root = opt => (opt?.base || base).replace(/\/+$/, '');
  return {
    label, needsKey: true, base,
    async models(_key, opt) {
      const r = await fetch(root(opt) + '/models');
      if (!r.ok) throw new Error(`models: HTTP ${r.status}`);
      const j = await r.json();
      // pricing is kept as the provider sent it (USD strings, per token unless noted)
      return (j.data || []).map(m => ({ id: m.id, name: m.name || m.id, ctx: m.context_length ?? null, pricing: m.pricing || {} }));
    },
    async *stream(body, key, signal, opt = {}) {
      const url = root(opt) + '/chat/completions';
      const t0 = performance.now(), dt = () => Math.round(performance.now() - t0);
      const rec = { t: new Date().toISOString(), url, request: body, status: 0, chunks: [] };
      opt.trace?.push(rec);
      try {
        const r = await fetch(url, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify(body),
        });
        rec.status = r.status;
        rec.headersMs = dt();
        if (!r.ok) {
          const text = await r.text();
          rec.chunks.push([dt(), text]);
          let msg = text;
          try { const j = JSON.parse(text); msg = j.error?.message || text; } catch {}
          throw new Error(`HTTP ${r.status}: ${msg.slice(0, 500)}`);
        }
        yield* sse(r, text => rec.chunks.push([dt(), text]));
      } catch (e) {
        rec.error = String(e.message || e);
        throw e;
      } finally { rec.ms = dt(); }
    },
  };
}

// Offline provider for demos and tests. It streams canned replies, calls a tool
// when the user message contains "tool", and reports usage with a simulated
// prefix cache (64-token units, ~4 chars per token) so the ledger can be exercised.
let mockPrev = '';
const mock = {
  label: 'Mock (offline)', needsKey: false,
  async models() { return [{ id: 'mock-1', name: 'Mock 1', ctx: 32000, pricing: { prompt: '0.00000015', completion: '0.0000006', input_cache_read: '0.000000003' } }]; },
  async *stream(body, _key, signal) {
    const flat = JSON.stringify(body.tools || []) + '\n' + body.messages.map(m => JSON.stringify(m)).join('\n');
    let kept = 0;
    while (kept < mockPrev.length && kept < flat.length && mockPrev[kept] === flat[kept]) kept++;
    mockPrev = flat;
    const prompt = Math.ceil(flat.length / 4);
    const cached = Math.floor(kept / 4 / 64) * 64;
    const last = body.messages[body.messages.length - 1];
    const tick = () => new Promise((ok, no) => {
      if (signal?.aborted) return no(new DOMException('Aborted', 'AbortError'));
      setTimeout(ok, 15);
    });
    let text = '';
    if (last.role === 'tool') text = 'The tool returned:\n\n```json\n' + last.content + '\n```';
    else if (/widget/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'show_widget', arguments: JSON.stringify({ title: 'Demo widget', html: '<button onclick="this.textContent=Number(this.textContent)+1">0</button>' }) } }] } }] };
    } else if (/tool/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: '' } }] } }] };
      for (const part of ['{"code":', '"console.log(\'hi\'); ', 'return 6*7"}']) {
        await tick();
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: part } }] } }] };
      }
    } else text = 'Mock reply. Say "tool" or "widget" to see a tool call.\n\n```js\nconst echo = ' + JSON.stringify(String(last.content).slice(0, 60)) + ';\n```';
    for (const w of text.split(/(?<=\s)/)) { await tick(); yield { choices: [{ delta: { content: w } }] }; }
    yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: Math.ceil(text.length / 4), prompt_tokens_details: { cached_tokens: cached }, cost: 0 } };
  },
};

export const providers = {
  openrouter: openaiCompatible({ label: 'OpenRouter', base: 'https://openrouter.ai/api/v1' }),
  mock,
};
