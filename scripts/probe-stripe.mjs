// Bounded live probe of the striping reducer (docs/STRIPE.md section 7 item 6, scaled down). One cheap model, hard request cap.
// Blobs x conditions x two asks: 6 x 3 x 2 = 36 requests (cap 40 including any error). Questions and keyword lists are fixed below, before any run.
//   conditions: full (ceiling), stripe (stripe-1.0 auto, fraction 0.25), ends (head and tail at equal output chars)
//   asks: about (one sentence; scored by keyword overlap) and fact (one identifier or number present in the blob; scored by substring match)
// Key: read from the one line of C:\wh\secrets.env that names OPENROUTER_API_KEY; never printed, logged or written. Headers are never stored.
// Usage: node scripts/probe-stripe.mjs [--date YYYY-MM-DD] [--dry] [--summary]   (resumable: cells already in the jsonl are skipped)
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripe, fingerprint } from '../app/stripe.js';
import { squeeze } from '../app/outstore.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1] ?? true) : d; };
const DATE = arg('date', new Date().toISOString().slice(0, 10)), DRY = process.argv.includes('--dry'), SUMMARY = process.argv.includes('--summary');
const OUTDIR = join(ROOT, 'docs/concepts/results'), JSONL = join(OUTDIR, `stripe-probe-${DATE}.jsonl`), MD = join(OUTDIR, `stripe-probe-${DATE}.md`);
const MODEL = 'qwen/qwen3.7-flash', CAP = 40, PIN = 'fbdd865', FRACTION = 0.25;
const SECRETS = (typeof arg('secrets') === 'string' && arg('secrets')) || process.env.STRIPE_PROBE_SECRETS || 'C:\\wh\\secrets.env', KEYVAR = 'OPENROUTER_API_KEY';
const MAXTOK = { about: 160, fact: 60 };

const rd = p => readFileSync(join(ROOT, p), 'utf8');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });

// ---------------------------------------------------------------- blobs, questions (fixed), keyword rubrics (fixed)
function blobs() {
  const out = [];
  out.push({ id: 'docs', src: 'docs/PROTOCOL.md', text: squeeze(rd('docs/PROTOCOL.md')),
    q: 'Which script file runs a scenario against the live page or a local copy? Give the file name.', truth: 'drive.mjs', kw: ['driv', 'session', 'bridge', 'script', 'command'] });
  const cl = rd('catalog/concepts.jsonl').split('\n').filter(Boolean).slice(-10), rec = JSON.parse(cl[5]); // median-line rule: the sixth of the last ten records
  out.push({ id: 'catalog', src: 'catalog/concepts.jsonl (last 10 lines)', text: squeeze(cl.join('\n')),
    q: `In these records, what is the id of the record whose name is "${rec.name}"?`, truth: rec.id, kw: ['concept', 'claim', 'status', 'model', 'record'] });
  const fj = JSON.parse(rd('scripts/fixtures/failures-pre-aa62df3.json')), ent = fj.local.find(e => e.stub && e.stub.status); // first entry with a stub status
  out.push({ id: 'json', src: 'scripts/fixtures/failures-pre-aa62df3.json', text: squeeze(rd('scripts/fixtures/failures-pre-aa62df3.json')),
    q: `What status does the stub return for the entry named "${ent.name}"? Give the number.`, truth: String(ent.stub.status), kw: ['error', 'tool', 'bridge', 'token', 'fail'] });
  const code = squeeze(rd('app/outstore.js'));
  out.push({ id: 'code', src: 'app/outstore.js', text: code, q: 'What number is READ_MAX set to? Give the number.', truth: /READ_MAX = (\d+)/.exec(code)[1], kw: ['output', 'stor', 'handle', 'squeez', 'tool'] });
  const gl = git('log', '--oneline', '-n', '50', PIN).trim().split('\n'), gm = gl[25], gh = gm.slice(0, gm.indexOf(' ')); // median-line rule
  out.push({ id: 'log', src: `git log --oneline -n 50 ${PIN}`, text: squeeze(gl.join('\n')),
    q: `What is the commit hash of the commit whose message is "${gm.slice(gm.indexOf(' ') + 1)}"?`, truth: gh, kw: ['commit', 'stripe|striping', 'spec', 'catalog', 'doc'] });
  const tl = git('ls-tree', '-r', '-l', PIN, '--', 'app').trim().split('\n'), tm = /^\d+ blob \w+\s+(\d+)\t(.+)$/.exec(tl[Math.floor(tl.length / 2)]); // median-line rule
  out.push({ id: 'table', src: `git ls-tree -r -l ${PIN} -- app`, text: squeeze(tl.join('\n')),
    q: `What is the size in bytes of ${tm[2]}? Give the number.`, truth: tm[1], kw: ['app', 'file', 'size', 'js', 'tree|listing|list'] });
  return out;
}
function ends(text, outLen, ref) { // outstore.present 'ends' (900 head : 400 tail) sized to outLen chars, tag counted
  const tag = `[${ref} ${text.split('\n').length}L ends]`, room = Math.max(2, outLen - tag.length - 8), h = Math.max(1, Math.round(room * 900 / 1300)), t = Math.max(1, room - h);
  const hh = Math.min(h, text.length), tt = Math.min(t, text.length - hh);
  return `${tag}\n${text.slice(0, hh)}\n[...]\n${text.slice(text.length - tt)}`;
}
function views(b) {
  const ref = 'os:' + fingerprint(b.text), s = stripe(b.text, { fraction: FRACTION, handle: ref });
  return { full: b.text, stripe: s.text, ends: ends(b.text, s.text.length, ref) };
}
const frame = (view, ask) => `Here is the stored result of a tool call. It may be shortened; the full text is kept elsewhere.\n\n<<<\n${view}\n>>>\n\n${ask}`;
const ASK = { about: () => 'In one sentence, say what this text is about.', fact: b => `${b.q} Reply with only the answer, copied exactly.` };

// ---------------------------------------------------------------- scoring (by script)
const norm = s => String(s || '').toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1');
const factOk = (resp, truth) => { const r = norm(resp), t = norm(truth); return /^\d+$/.test(t) ? new RegExp(`(^|\\D)${t}(\\D|$)`).test(r) : r.includes(t); };
const kwScore = (resp, kws) => kws.filter(k => new RegExp(k, 'i').test(resp)).length / kws.length;
const kwInView = (view, kws) => kws.filter(k => new RegExp(k, 'i').test(view)).length / kws.length;

function key() {
  if (!existsSync(SECRETS)) return null;
  const line = readFileSync(SECRETS, 'utf8').split(/\r?\n/).find(l => l.startsWith(KEYVAR + '='));
  return line ? line.slice(KEYVAR.length + 1).trim().replace(/^["']|["']$/g, '') : null;
}
const done = () => existsSync(JSONL) ? readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

async function runAll() {
  const B = blobs(), cells = [];
  for (const b of B) { const v = views(b); for (const cond of ['full', 'stripe', 'ends']) for (const task of ['about', 'fact']) cells.push({ b, cond, task, view: v[cond] }); }
  if (DRY) { for (const c of cells) console.log(c.b.id, c.cond, c.task, 'view', c.view.length, 'of', c.b.text.length, '| truth in view', c.view.includes(c.b.truth)); for (const b of B) console.log(b.id, '|', b.q, '=>', b.truth); return; }
  const k = key();
  if (!k) { console.log(`skipped: ${existsSync(SECRETS) ? 'no ' + KEYVAR + ' line' : 'no secrets file'}; nothing sent`); return; }
  mkdirSync(OUTDIR, { recursive: true });
  const have = done(); let used = have.length;
  for (const c of cells) {
    if (have.some(h => h.cell.blob === c.b.id && h.cell.cond === c.cond && h.cell.task === c.task)) continue;
    if (used >= CAP) { console.log('request cap reached'); break; }
    const request = { model: MODEL, messages: [{ role: 'user', content: frame(c.view, ASK[c.task](c.b)) }], max_tokens: MAXTOK[c.task], temperature: 0, reasoning: { enabled: false }, usage: { include: true } };
    const t0 = Date.now(); used++;
    let status = 0, body = null, err = null;
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k }, body: JSON.stringify(request), signal: AbortSignal.timeout(90000) });
      status = r.status; body = await r.json().catch(() => null);
    } catch (e) { err = String(e.message || e).slice(0, 200); }
    const ch = body?.choices?.[0], content = ch?.message?.content ?? '';
    const rec = { cell: { blob: c.b.id, cond: c.cond, task: c.task }, src: c.b.src, model: MODEL, ts: new Date().toISOString(), ms: Date.now() - t0, request, status, error: err || (body?.error ? { message: String(body.error.message || '').slice(0, 300), code: body.error.code } : null),
      response: body && !body.error ? { id: body.id, model: body.model, provider: body.provider, finish_reason: ch?.finish_reason, content, reasoning: ch?.message?.reasoning ? String(ch.message.reasoning).slice(0, 400) : undefined, usage: body.usage } : null,
      view: { chars: c.view.length, fullChars: c.b.text.length },
      truth: c.task === 'fact' ? { value: c.b.truth, inView: c.view.includes(c.b.truth) } : { keywords: c.b.kw, inView: kwInView(c.view, c.b.kw) },
      score: c.task === 'fact' ? (factOk(content, c.b.truth) ? 1 : 0) : kwScore(content, c.b.kw) };
    appendFileSync(JSONL, JSON.stringify(rec) + '\n');
    console.log(c.b.id, c.cond, c.task, 'status', status, 'score', rec.score, 'finish', ch?.finish_reason ?? '-');
    if (status !== 200) { console.log('stopping after a failed request:', rec.error ? JSON.stringify(rec.error) : status); break; }
  }
}

function summary() {
  const rs = done().filter(r => r.status === 200 && r.response);
  const conds = ['full', 'stripe', 'ends'], tasks = ['fact', 'about'], blobsIds = [...new Set(rs.map(r => r.cell.blob))];
  const pick = (c, t, b) => rs.find(r => r.cell.cond === c && r.cell.task === t && (!b || r.cell.blob === b));
  let md = `# stripe-1.0 live probe, ${DATE}\n\nModel \`${MODEL}\` (temperature 0, reasoning off, max_tokens ${MAXTOK.about}/${MAXTOK.fact}); ${rs.length} requests; one run per cell, so n is 6 blobs per condition: read the counts, not the percentages. Script \`scripts/probe-stripe.mjs\`; pairs in \`stripe-probe-${DATE}.jsonl\` (no keys, no headers). No legend for the marker notation was given to the model in any condition.\n\n`;
  md += `| condition | view chars (mean) | prompt tokens (mean, fact asks) | fact correct | fact answer in view | about keyword score (mean of 6) | about keywords in view (mean) |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
  const agg = {};
  for (const c of conds) {
    const f = rs.filter(r => r.cell.cond === c && r.cell.task === 'fact'), a = rs.filter(r => r.cell.cond === c && r.cell.task === 'about');
    agg[c] = { factOk: f.filter(r => r.score === 1).length, factN: f.length, inView: f.filter(r => r.truth.inView).length, aboutMean: a.length ? a.reduce((s, r) => s + r.score, 0) / a.length : null, aboutN: a.length, kwView: a.length ? a.reduce((s, r) => s + r.truth.inView, 0) / a.length : null, chars: f.length ? f.reduce((s, r) => s + r.view.chars, 0) / f.length : null, ptok: f.length ? f.reduce((s, r) => s + (r.response.usage?.prompt_tokens || 0), 0) / f.length : null };
    const x = agg[c];
    md += `| ${c} | ${x.chars == null ? '-' : Math.round(x.chars)} | ${x.ptok == null ? '-' : Math.round(x.ptok)} | ${x.factOk}/${x.factN} | ${x.inView}/${x.factN} | ${x.aboutMean == null ? '-' : x.aboutMean.toFixed(2)} (n ${x.aboutN}) | ${x.kwView == null ? '-' : x.kwView.toFixed(2)} |\n`;
  }
  md += `\n## Per blob (fact: 1 correct, 0 wrong, in view y/n; about: keyword score)\n\n| blob | view chars full/stripe/ends | fact full | fact stripe | fact ends | about full | about stripe | about ends |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const b of blobsIds) {
    const cell = (c, t) => { const r = pick(c, t, b); return r ? (t === 'fact' ? `${r.score}${r.truth.inView ? ' y' : ' n'}` : r.score.toFixed(1)) : '-'; };
    md += `| ${b} | ${conds.map(c => pick(c, 'fact', b)?.view.chars ?? '-').join('/')} | ${cell('full', 'fact')} | ${cell('stripe', 'fact')} | ${cell('ends', 'fact')} | ${cell('full', 'about')} | ${cell('stripe', 'about')} | ${cell('ends', 'about')} |\n`;
  }
  const u = rs.reduce((s, r) => ({ p: s.p + (r.response.usage?.prompt_tokens || 0), c: s.c + (r.response.usage?.completion_tokens || 0), $: s.$ + (r.response.usage?.cost || 0) }), { p: 0, c: 0, $: 0 });
  md += `\nTotals: prompt tokens ${u.p}, completion tokens ${u.c}, cost ${u.$.toFixed(6)} (as reported by the provider). Finish reasons: ${JSON.stringify(rs.reduce((m, r) => (m[r.response.finish_reason] = (m[r.response.finish_reason] || 0) + 1, m), {}))}.\n`;
  writeFileSync(MD, md); console.log(md);
}

if (SUMMARY) summary(); else await runAll();
