import * as ck from './checkpoints.js';
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
      return (j.data || []).map(m => ({ id: m.id, name: m.name || m.id, ctx: m.context_length ?? null, pricing: m.pricing || {}, tools: (m.supported_parameters || []).includes('tools') }));
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
const mockSeen = []; // recent flattened requests, standing in for a provider-side prefix cache
const bpSeen = new Set(); // prefixes written at explicit breakpoints
let mockStalled = false;
const mock = {
  label: 'Mock (offline)', needsKey: false,
  async models() {
    return [
      { id: 'mock-1', name: 'Mock 1', ctx: 32000, tools: true, pricing: { prompt: '0.00000015', completion: '0.0000006', input_cache_read: '0.000000003' } },
      { id: 'mock-bp', name: 'Mock Breakpoints', ctx: 200000, tools: true, pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' } },
      { id: 'mock-pro', name: 'Mock Pro', ctx: 1048576, tools: true, pricing: { prompt: '0.000002', completion: '0.00001' } },
      { id: 'mock-free:free', name: 'Mock Free', ctx: 262144, tools: false, pricing: { prompt: '0', completion: '0' } },
    ];
  },
  async *stream(body, _key, signal) {
    // explicit breakpoints (cache_control): entries are written only at marked points, and a
    // request reads the longest written prefix it starts with (the provider looks back from its tail)
    let bp = null;
    if (body.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.cache_control))) {
      const { lens, keys } = ck.bounds(body), marked = body.messages.map((m, i) => Array.isArray(m.content) && m.content.some(p => p.cache_control) ? i : -1).filter(i => i >= 0);
      let hit = 0;
      for (let i = lens.length - 1; i >= 0; i--) if (bpSeen.has(keys[i])) { hit = lens[i]; break; }
      const deep = marked.at(-1), write = bpSeen.has(keys[deep]) ? 0 : lens[deep] - hit;
      for (const i of marked) bpSeen.add(keys[i]);
      bp = { cached: Math.floor(hit / 4), write: Math.ceil(write / 4) };
      body = ck.strip(body);
    }
    const flat = JSON.stringify(body.tools || []) + '\n' + body.messages.map(m => JSON.stringify(m)).join('\n');
    let kept = 0;
    for (const prev of mockSeen) {
      let i = 0;
      while (i < prev.length && i < flat.length && prev[i] === flat[i]) i++;
      kept = Math.max(kept, i);
    }
    mockSeen.push(flat);
    if (mockSeen.length > 20) mockSeen.shift();
    const prompt = Math.ceil(flat.length / 4);
    // automatic prefix caching, except on the breakpoint model: like real breakpoint providers, nothing is cached without a mark
    const cached = /-bp$/.test(body.model || '') ? 0 : Math.floor(kept / 4 / 64) * 64;
    const last = body.messages[body.messages.length - 1];
    const tick = () => new Promise((ok, no) => {
      if (signal?.aborted) return no(new DOMException('Aborted', 'AbortError'));
      setTimeout(ok, 15);
    });
    // stalls once: sends nothing for 3 s (an upstream that stopped mid-stream), then behaves
    if (/\bstall once\b/.test(last.content || '') && !mockStalled) { mockStalled = true; for (let i = 0; i < 200; i++) await tick(); }
    let text = '';
    if (String(body.messages[0]?.content).startsWith('You condense')) {
      const said = [...last.content.matchAll(/^#(\d+) (title|reply)$/gm)].map(m => `#${m[1]}\n${m[2] === 'title' ? 'Mock Title ' + m[1] : 'condensed item ' + m[1]}`).join('\n');
      yield { choices: [{ delta: { content: said } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 0 }, cost: 0 } };
      return;
    }
    const sys0 = String(body.messages[0]?.content || '');
    if (sys0.startsWith('WATCH.')) {
      const said = /No machine|Tool error|Error:|Not run/i.test(last.content) ? 'FLAG: the call failed: ' + (/RESULT:\n(.*)/.exec(last.content)?.[1] || '').slice(0, 80) : 'ok';
      yield { choices: [{ delta: { content: said } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 0 }, cost: 0 } };
      return;
    }
    if (sys0.startsWith('TERMINAL SCRATCH')) {
      // first a test in the scratch account, then the commands (with a "why" line)
      const said = /TRIED:/.test(last.content) ? '```sh\nls -la ~\n# list the home folder\necho drafted-$((6*7))\n```' : 'TRY: echo scratch-test-$((40+2)); id -un';
      yield { choices: [{ delta: { content: said } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 0 }, cost: 0 } };
      return;
    }
    if (sys0.startsWith('You repair') || sys0.startsWith('You review')) {
      const said = sys0.startsWith('You review') ? 'POLICIES: keep p1 -- policy-rewritten 1 in 3 requests'
        : /refuse me/.test(last.content) ? '{"refuse": "cannot be made safe"}'
        : JSON.stringify({ arguments: { code: 'let i = 0; for (let k = 0; k < 100; k++) { if (++i > 5) break } return i' } });
      yield { choices: [{ delta: { content: said } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 }, cost: 0 } };
      return;
    }
    if (String(body.messages[0]?.content).startsWith('You filter')) {
      const said = 'mock-filtered: ' + /WANT: (.*)/.exec(last.content)[1];
      yield { choices: [{ delta: { content: said } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 0 }, cost: 0 } };
      return;
    }
    const concern = last.role === 'user' && /^concern (\S+):/.exec(last.content);
    // "round after round": a tool call after every result, so the turn ends at the harness's round limit
    const lastUser = body.messages.findLast(m => m.role === 'user');
    if (/\bround after round\b/.test(typeof lastUser?.content === 'string' ? lastUser.content : '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: JSON.stringify({ code: 'return ' + body.messages.filter(m => m.role === 'tool').length }) } }] } }] };
    } else if (/^wrap up/.test(last.content || '')) text ='OUTCOME: done\nRESULT: slow-path numbers: line 399 is the worst case\nEVIDENCE: 3 measurements\nOPEN: none';
    else if (concern) text = `OUTCOME: done\nRESULT: mock result for ${concern[1]}\nEVIDENCE: folds received: ${(last.content.match(/^fold \S+/gm) || []).length}\nOPEN: none`;
    else if (last.role === 'tool') text = 'The tool returned:\n\n```text\n' + last.content + '\n```';
    else if (/^event \S+: /.test(last.content || '')) text = 'Got the event: ' + last.content;
    else if (/^Write the pocket/.test(last.content || '')) text = '## Goal\nmock goal\n## Settled\n- mock decision\n## Open\n- none';
    else if (/^\[result /.test(last.content || '')) text = 'The result was read.';
    else if (/handoffs please/.test(last.content || '')) text = 'Here you go.\n\n```handoff:copy deploy note\nship it on friday\n```\n\n```handoff:file notes.md\n# Notes\n- one\n```\n\n```handoff:command list files\necho hello-from-command\n```\n\n```handoff:view csv sizes\nname,size\na,1\n"b, c",2\n```\n\n```handoff:config models\n{"settings": {"helper": "mock-pro"}}\n```\n\nAnd plain code:\n\n```js\nconst x = 1;\n```';
    else if (/copy that plain/.test(last.content || '')) text = 'Sure:\n\n```bash\nnpm test\n```';
    else if (/decide/.test(last.content || '')) text = 'Thinking it over at length.\n! port is 8787\nSome more musing.\n!! use the flash model\nDone musing. ' + 'filler '.repeat(120);
    else if (/ramble/.test(last.content || '')) text = 'word '.repeat(200);
    else if (/open (os:\w+)/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'entry_read', arguments: JSON.stringify({ handle: /open (os:\w+)/.exec(last.content)[1], part: 'transcript', why: 'need the exact wording of the musing' }) } }] } }] };
    } else if (/long script/.test(last.content || '')) {
      const code = "const out = []; for (let i = 0; i < 300; i++) { out.push('row ' + i + '   '); if (i === 150) out.push('total=4950'); } out.push('same', 'same', 'same'); return out.join('\\n'); // " + 'padding '.repeat(60);
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: JSON.stringify({ code, name: 'sum rows', want: 'total' }) } }] } }] };
    } else if (/request a value|set a value|revise value v\d+|use value v\d+|history of v\d+/.test(last.content || '')) {
      const c = last.content, id = /(v\d+)/.exec(c.replace(/^[^]*?(revise value|use value|history of) /, ''))?.[1];
      const call = /request a value/.test(c) ? ['value_request', { label: 'region', role: 'config', purpose: 'where deploys go', type: 'choice', options: ['eu-west-1', 'us-east-1'], why: 'deploy step needs it' }]
        : /set a value/.test(c) ? ['value_set', { label: 'naming', role: 'rule', value: 'kebab-case', purpose: 'how repos are named', why: 'agreed in chat' }]
        : /revise value/.test(c) ? ['value_set', { id, value: 'snake_case', why: 'the person changed their mind' }]
        : /use value/.test(c) ? ['run_js', { code: `return "deploying to {{${id}}}"` }]
        : ['value_get', { id, history: true }];
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } }] };
    } else if (/file a concern/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'concern_file', arguments: JSON.stringify({ kind: 'interop', title: 'gh api pagination input', what: 'gh api /user/repos returned 30 of 120 repos: --paginate was not passed', expected: 'pass --paginate for list endpoints', intent: 'complete lists for scope checks' }) } }] } }] };
    } else if (/ask me/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'ask', arguments: JSON.stringify({ questions: [
        { id: 'name', prompt: 'Repo name?', type: 'text' },
        { id: 'size', prompt: 'How many?', type: 'number', min: 1, max: 5 },
        { id: 'vis', prompt: 'Visibility?', type: 'choice', options: ['private', 'public'], default: 'private' },
        { id: 'tags', prompt: 'Labels?', type: 'multi', options: ['bug', 'docs', 'ci'] },
        { id: 'go', prompt: 'Proceed?', type: 'confirm' },
        { id: 'cfg', prompt: 'Config?', type: 'json', schema: { type: 'object', required: ['port'], properties: { port: { type: 'integer', minimum: 1 } } } },
      ] }) } }] } }] };
    } else if (/loop forever/.test(last.content || '')) {
      const code = /refuse me/.test(last.content) ? 'while (true) {} // refuse me' : 'let i = 0; while (true) { if (++i > 5) break } return i';
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: JSON.stringify({ code }) } }] } }] };
    } else if (/^shell: /.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'shell', arguments: JSON.stringify({ cmd: last.content.slice(7), timeout: 600 }) } }] } }] };
    } else if (/repo (deep edit|rewrite)/.test(last.content || '')) {
      // "repo deep edit": one edit far down a large file; "repo rewrite": an existing file written whole, and a new file
      const changes = /deep edit/.test(last.content) ? [{ path: 'big.js', edits: [{ find: 'agentRun(cmd, t, o)', replace: 'agentRun(cmd, t, { ...o, session: s.id })' }] }]
        : [{ path: 'a.txt', content: 'hello world\nsecond line\n' }, { path: 'notes/new.txt', content: 'one\ntwo' }];
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'repo_commit', arguments: JSON.stringify({ repo: 'o/r', branch: /deep edit/.test(last.content) ? 'deep' : 'rewrite', message: 'Change files\n\nfrom the mock', changes }) } }] } }] };
    } else if (/repo (read|commit|pr)/.test(last.content || '')) {
      const op = /repo (read|commit|pr)/.exec(last.content)[1];
      // "repo read path <path> [lines a-b]" reads that path (a slice with lines); plain "repo read" reads a.txt whole
      const rp = /repo read path (\S+)(?: lines (\d+-\d+))?/.exec(last.content);
      const call = op === 'read' ? ['repo_read', { repo: 'o/r', op: 'file', path: rp ? rp[1] : 'a.txt', ...(rp?.[2] ? { lines: rp[2] } : {}) }]
        : op === 'commit' ? ['repo_commit', { repo: 'o/r', branch: 'feat', message: 'Change greeting\n\nfrom the mock', changes: [{ path: 'a.txt', edits: [{ find: 'hello', replace: 'goodbye' }] }, { path: 'b.txt', content: 'new file' }] }]
        : ['repo_pr', { repo: 'o/r', head: 'feat', title: 'Change greeting' }];
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } }] };
    } else if (/run pattern (pt:\w+)/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'pattern_run', arguments: JSON.stringify({ id: /run pattern (pt:\w+)/.exec(last.content)[1], values: { a: 6, b: 7 } }) } }] } }] };
    } else if (/store pattern/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'pattern_put', arguments: JSON.stringify({ kind: 'recipe', title: 'multiply two numbers', labels: ['math'], slots: ['a', 'b'], recipe: { tool: 'run_js', args: { code: 'return {{a}} * {{b}}' } }, refs: ['os:doesnotexist'] }) } }] } }] };
    } else if (/slice (os:\w+) (?:lines (\d+-\d+)|offset (\d+) length (\d+))/.test(last.content || '')) {
      // "slice os:… lines a-b" / "slice os:… offset n length m": a stored output read by line range or by characters
      const [, handle, lines, offset, length] = /slice (os:\w+) (?:lines (\d+-\d+)|offset (\d+) length (\d+))/.exec(last.content);
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'output_read', arguments: JSON.stringify(lines ? { handle, lines } : { handle, offset: Number(offset), length: Number(length) }) } }] } }] };
    } else if (/js reads (os:\w+)/.test(last.content || '')) {
      // "js reads os:…": code that calls a tool by name as if it were a function there
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: JSON.stringify({ code: `return await output_read({ handle: "${/js reads (os:\w+)/.exec(last.content)[1]}" })` }) } }] } }] };
    } else if (/\bpull ([a-z][a-z0-9]{5})\b/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'output_read', arguments: JSON.stringify({ handle: /\bpull ([a-z][a-z0-9]{5})\b/.exec(last.content)[1] }) } }] } }] };
    } else if (/read (os:\w+)/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'output_read', arguments: JSON.stringify({ handle: /read (os:\w+)/.exec(last.content)[1], find: 'line 399' }) } }] } }] };
    } else if (/\bbroken call\b/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: '', arguments: '{"code": "return 1"' } }] } }] };
    } else if (/\bfn tool\b/.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: JSON.stringify({ code: 'async function () {\n  return 6 * 7;\n}' }) } }] } }] };
    } else if (/big/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: JSON.stringify({ code: "return Array.from({length:400},(_,i)=>'line '+i).join('\\n')" }) } }] } }] };
    } else if (/form/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'show_widget', arguments: JSON.stringify({ slot: 'demo', kind: 'form', title: 'Demo form', data: { fields: [{ name: 'name', label: 'Name' }, { name: 'n', label: 'Count', type: 'number', value: 3 }], submit: 'Send' } }) } }] } }] };
    } else if (/show an image/i.test(last.content || '')) {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'show_widget', arguments: JSON.stringify({ slot: 'img', kind: 'image', title: 'Dot', data: { url: 'data:image/png;base64,' + png } }) } }] } }] };
    } else if (/chart/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'show_widget', arguments: JSON.stringify({ slot: 'demo', kind: 'chart', title: 'Demo chart', data: { type: 'bar', labels: ['a', 'b', 'c', 'd'], values: [3, 7, 4, 9] } }) } }] } }] };
    } else if (/widget/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'show_widget', arguments: JSON.stringify({ slot: 'counter', kind: 'html', title: 'Demo widget', data: { html: '<button onclick="this.textContent=Number(this.textContent)+1">0</button> <button onclick="emit({clicked:true})">report</button>' } }) } }] } }] };
    } else if (/fan ?out/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'fan_out', arguments: JSON.stringify({ concerns: [{ id: 'a', task: 'First part.' }, { id: 'b', task: 'Second part.' }, { id: 'c', task: 'Combine a and b.', after: ['a', 'b'] }] }) } }] } }] };
    } else if (/tool/i.test(last.content || '')) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'run_js', arguments: '' } }] } }] };
      for (const part of ['{"code":', '"console.log(\'hi\'); ', 'return 6*7"}']) {
        await tick();
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: part } }] } }] };
      }
    } else text = 'Mock reply. Say "tool", "big", "widget", "form", "chart" or "fan out" to see a tool call.\n\n```js\nconst echo = ' + JSON.stringify(String(last.content).slice(0, 60)) + ';\n```';
    for (const w of text.split(/(?<=\s)/)) { await tick(); yield { choices: [{ delta: { content: w } }] }; }
    yield { provider: 'MockCloud', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: Math.ceil(text.length / 4), completion_tokens_details: { reasoning_tokens: 5 }, prompt_tokens_details: bp ? { cached_tokens: bp.cached, cache_write_tokens: bp.write } : { cached_tokens: cached }, cost: 0 } };
  },
};

export const providers = {
  openrouter: openaiCompatible({ label: 'OpenRouter', base: 'https://openrouter.ai/api/v1' }),
  mock,
};
