// Provider seam: a chat request that fails before any chunk with a transient error is asked again.
// From the live stepped session 1 (docs/concepts/HYPOTHESES.md): 2 of 125 requests came back HTTP 502 and
// nothing retried, so each ended the turn.
// Node only, no browser, no network: the mock provider (trigger "fail <status> x<n> [late]": the request fails
// n times with that status, then succeeds; "late" fails after the first chunk) and, for the real provider's code path,
// a stand-in for fetch. Run: node scripts/test-retry.mjs
import * as P from '../app/providers.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail)); if (!ok) fails++; };
const J = v => { try { return JSON.stringify(v) ?? 'undefined'; } catch { return String(v); } };
const mock = P.providers.mock;
const body = text => ({ model: 'mock-1', messages: [{ role: 'system', content: 'You are a test assistant.' }, { role: 'user', content: text }], stream: true });
const drain = async gen => { const out = []; try { for await (const e of gen) out.push(e); } catch (err) { return { out, err }; } return { out }; };
const text = out => out.map(e => e.choices?.[0]?.delta?.content || '').join('');
const sent = t => mock.requests.filter(b => b.messages.at(-1)?.content === t);
// one request through the mock; delays are injected so a check does not wait
const go = async (t, o = {}, signal) => { const opt = { retryDelays: [0, 0], ...o }; const r = await drain(mock.stream(body(t), '', signal, opt)); return { ...r, opt, n: sent(t).length }; };

// ---- the mock's behaviour: fails n times, then succeeds ----
const a = await go('fail 502 x2 first');
check('retry: a 502 that happens twice is asked again and the request succeeds', !a.err && /Mock reply/.test(text(a.out)) && a.n === 3, J([a.err?.message, a.n]));
check('retry: the number of retries a request took is told to the caller (2)', a.opt.retries === 2, J(a.opt));

const b = await go('fail 502 x3 second');
check('retry: after two more attempts it stops: the third 502 is the error, as thrown before', b.err?.message === 'HTTP 502: Provider returned error' && b.n === 3 && b.out.length === 0, J([b.err?.message, b.n]));
check('retry: the error carries its HTTP status', b.err?.status === 502, J(b.err?.status));
check('retry: the retries a failed request took are told too (2)', b.opt.retries === 2, J(b.opt));

// ---- which failures are retried ----
for (const st of [503, 504, 429]) {
  const r = await go(`fail ${st} x1 status${st}`);
  check(`retry: HTTP ${st} is retried`, !r.err && r.n === 2 && r.opt.retries === 1, J([r.err?.message, r.n, r.opt.retries]));
}
for (const st of [400, 401, 404, 500]) {
  const r = await go(`fail ${st} x1 status${st}`);
  check(`retry: HTTP ${st} is not retried`, r.err?.status === st && r.n === 1 && !r.opt.retries, J([r.err?.message, r.n, r.opt.retries]));
}

// ---- never once a chunk was yielded ----
const late = await go('fail 502 x2 late third late');
check('retry: a failure after a chunk was yielded is not retried (the caller has seen content)', late.err?.status === 502 && late.out.length >= 1 && late.n === 1 && !late.opt.retries, J([late.err?.message, late.out.length, late.n]));

// ---- the user's abort is never retried ----
{
  const ac = new AbortController(); ac.abort();
  const r = await go('fail 502 x2 aborted before', {}, ac.signal);
  check('retry: a request aborted by the user is not asked again', r.err?.name === 'AbortError' && r.n === 1, J([r.err?.name, r.err?.message, r.n]));
  const ac2 = new AbortController(), t0 = Date.now();
  setTimeout(() => ac2.abort(), 30);
  const w = await go('fail 502 x2 aborted during', { retryDelays: [400, 400] }, ac2.signal);
  check('retry: an abort during the wait ends it at once, without another request', w.err?.name === 'AbortError' && w.n === 1 && Date.now() - t0 < 300, J([w.err?.name, w.n, Date.now() - t0]));
}

// ---- the backoff: about 1 s, then 3 s; injectable ----
{
  const waits = [];
  const r = await drain(mock.stream(body('fail 502 x2 backoff'), '', undefined, { sleep: ms => (waits.push(ms), Promise.resolve()) }));
  check('retry: the default waits are 1000 ms, then 3000 ms', !r.err && J(waits) === '[1000,3000]', J(waits) + ' ' + (r.err?.message || ''));
  const waits2 = [];
  await drain(mock.stream(body('fail 502 x9 backoff cap'), '', undefined, { sleep: ms => (waits2.push(ms), Promise.resolve()) }));
  check('retry: at most two more attempts, whatever the failures', waits2.length === 2 && sent('fail 502 x9 backoff cap').length === 3, J([waits2, sent('fail 502 x9 backoff cap').length]));
}

// ---- what the model is given ----
{
  const reqs = sent('fail 502 x2 first');
  check('retry: every attempt sends the same body', reqs.length === 3 && reqs.every(r => J(r) === J(reqs[0])), String(reqs.length));
  check('retry: the retry count is not in what a model is sent', !/retr/i.test(J(mock.requests.filter(r => /fail 50\d x/.test(J(r))))), '');
}

// ---- a network error before the response started ----
{
  const calls = [];
  const flaky = P.retrying?.({ label: 'flaky', async *stream() { calls.push(1); if (calls.length === 1) throw new TypeError('Failed to fetch'); yield { choices: [{ delta: { content: 'ok' } }] }; } });
  const opt = { retryDelays: [0, 0] };
  const r = flaky ? await drain(flaky.stream({}, '', undefined, opt)) : { err: new Error('retrying() is not exported') };
  check('retry: a network error before the response is retried', !r.err && text(r.out) === 'ok' && opt.retries === 1, J([r.err?.message, calls.length, opt.retries]));
  const calls2 = [];
  const cut = P.retrying?.({ label: 'cut', async *stream() { calls2.push(1); yield { choices: [{ delta: { content: 'a' } }] }; throw new TypeError('network error'); } });
  const r2 = cut ? await drain(cut.stream({}, '', undefined, { retryDelays: [0, 0] })) : { err: null };
  check('retry: a network error after a chunk is not retried', !!cut && r2.err?.name === 'TypeError' && calls2.length === 1, J([r2.err?.message, calls2.length]));
}

// ---- the real provider's code path, with a stand-in for fetch (no network) ----
{
  const realFetch = globalThis.fetch;
  const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\ndata: [DONE]\n\n';
  const stub = list => { const seen = []; globalThis.fetch = async (url, init) => { seen.push({ url, init }); const x = list[Math.min(seen.length - 1, list.length - 1)]; if (x instanceof Error) throw x; return new Response(x === 200 ? sse : JSON.stringify({ error: { message: 'Provider returned error' } }), { status: x }); }; return seen; };
  try {
    const or = P.providers.openrouter;
    let seen = stub([502, 502, 200]), trace = [];
    let o = { retryDelays: [0, 0], trace };
    let r = await drain(or.stream(body('x'), 'sk-test-not-a-key', undefined, o));
    check('retry: the real provider asks again after a 502 and returns the answer', !r.err && text(r.out) === 'hi' && seen.length === 3 && o.retries === 2, J([r.err?.message, seen.length, o.retries]));
    check('retry: each attempt is in the trace with its status', trace.map(t => t.status).join() === '502,502,200' && !J(trace).includes('sk-test-not-a-key'), J(trace.map(t => t.status)));
    seen = stub([new TypeError('Failed to fetch'), 200]); o = { retryDelays: [0, 0] };
    r = await drain(or.stream(body('x'), 'k', undefined, o));
    check('retry: the real provider asks again after a network error before the response', !r.err && text(r.out) === 'hi' && seen.length === 2 && o.retries === 1, J([r.err?.message, seen.length, o.retries]));
    seen = stub([400]); o = { retryDelays: [0, 0] };
    r = await drain(or.stream(body('x'), 'k', undefined, o));
    check('retry: the real provider does not ask again after a 400', r.err?.status === 400 && /^HTTP 400: Provider returned error/.test(r.err.message) && seen.length === 1 && !o.retries, J([r.err?.message, seen.length]));
    seen = stub([503]); o = { retryDelays: [0, 0] };
    r = await drain(or.stream(body('x'), 'k', undefined, o));
    check('retry: the real provider gives up after two more attempts with the error as before', r.err?.message === 'HTTP 503: Provider returned error' && seen.length === 3 && o.retries === 2, J([r.err?.message, seen.length, o.retries]));
  } finally { globalThis.fetch = realFetch; }
}

process.exitCode = fails ? 1 : 0;
