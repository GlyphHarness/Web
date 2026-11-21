// A1.1 read-path corpus: builds the data snapshot, computes each question's expected answer WITHOUT a model,
// writes the corpus jsonl, and scores answers (exact match of the normalized final ANSWER line).
// Plain node, no browser, no network.
//   node scripts/a1-corpus.mjs build  [--dir C:\wh\a1data]            snapshot from the pinned commit, prints file hashes
//   node scripts/a1-corpus.mjs expect [--dir ...] [--out file.jsonl]    compute expected answers, write the corpus jsonl
//   node scripts/a1-corpus.mjs score  <answers.jsonl> [--corpus file]   answers: {"id","answer"} per line
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIN = '53cfaa1'; // the epics head the data is taken from; the snapshot never changes with later commits
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = ['concepts', 'faults', 'nomenclature'].map(n => `catalog/${n}.jsonl`);
const PROFILES = ['profile-2026-11-19', 'profile-h1-canary-2026-11-20', 'profile-h12-blue-2026-11-20', 'profile-h12-green-2026-11-20',
  'profile-h12-t4-blue-2026-11-20', 'profile-h12-t4-green-2026-11-20', 'profile-h12-t5-blue-2026-11-20', 'profile-h12-t5-green-2026-11-20',
  'profile-live1-2026-11-20', 'profile-live2-2026-11-20'].map(n => `docs/concepts/${n}.json`);

const sha = b => createHash('sha256').update(b).digest('hex');
const git = p => execFileSync('git', ['-C', root, 'show', `${PIN}:${p}`], { maxBuffer: 1e8 });
const snapPath = p => p.startsWith('catalog/') ? p : `profiles/${p.split('/').pop()}`;

export function build(dir) {
  const files = [];
  for (const p of [...CATALOG, ...PROFILES]) {
    const b = git(p), to = join(dir, snapPath(p));
    mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, b);
    files.push({ path: '/' + snapPath(p), bytes: b.length, sha256: sha(b) });
  }
  return files;
}

const jl = (dir, f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const prof = (dir, n) => JSON.parse(readFileSync(join(dir, `profiles/${n}.json`), 'utf8'));
// current view: a record is current when no later line names it in `supersedes`
const view = L => { const sup = new Set(L.map(r => r.supersedes).filter(Boolean)); return L.filter(r => !sup.has(r.id)); };
const tail = (L, id) => { let cur = L.find(r => r.id === id); if (!cur) throw new Error('no ' + id); for (;;) { const n = L.find(r => r.supersedes === cur.id); if (!n) return cur; cur = n; } };
const line = (L, r) => L.indexOf(r) + 1;
const one = (a, what) => { if (a.length !== 1) throw new Error(`${what}: ${a.length} matches`); return a[0]; };

const PRE = 'Data folder "data" holds three append-only catalogs (catalog/concepts.jsonl, catalog/faults.jsonl, catalog/nomenclature.jsonl, one JSON record per line, ids are 6 lowercase letters) and ten profile files (profiles/*.json). A catalog line with "supersedes": "<id>" replaces the earlier record with that id; the current record of a chain is the last line of the chain, and a record that nothing supersedes is current. Use the read-only folder tools to look, do not guess. Finish with one final line "ANSWER: <value>" holding only the value (a word, id, number or path).';
const rows = (dir, n) => prof(dir, n).sessions.flatMap(s => s.rows || []);

// shape: lookup | aggregation | locate-then-act. act is stated, not applied (no write tool in stage 0).
export const QUESTIONS = [
  { id: 'q01', shape: 'lookup', q: 'What is the current status of the concept named "stems" in catalog/concepts.jsonl?',
    how: 'view(concepts) with name == "stems" (exactly one) -> .status', f: d => one(view(jl(d, 'catalog/concepts.jsonl')).filter(r => r.name === 'stems'), 'stems').status },
  { id: 'q02', shape: 'lookup', q: 'In catalog/faults.jsonl, the chain that starts at the record with id iqdjnn: what is the id of its last (current) record?',
    how: 'follow supersedes forward from iqdjnn -> .id', f: d => tail(jl(d, 'catalog/faults.jsonl'), 'iqdjnn').id },
  { id: 'q03', shape: 'lookup', q: 'What is the "see" path of the current nomenclature record whose term is "stem" in catalog/nomenclature.jsonl?',
    how: 'view(nomenclature) with term == "stem" (exactly one) -> .see', f: d => one(view(jl(d, 'catalog/nomenclature.jsonl')).filter(r => r.term === 'stem'), 'stem').see },
  { id: 'q04', shape: 'lookup', q: 'In catalog/faults.jsonl, the chain that starts at the record with id tuwpcr: what is the "class" of its last (current) record?',
    how: 'follow supersedes forward from tuwpcr -> .class', f: d => tail(jl(d, 'catalog/faults.jsonl'), 'tuwpcr').class },
  { id: 'q05', shape: 'lookup', q: 'In profiles/profile-live1-2026-11-20.json, what is the "cachePct" of its one entry in "groups"?',
    how: 'groups.length == 1 -> groups[0].cachePct', f: d => { const g = prof(d, 'profile-live1-2026-11-20').groups; return String(one(g, 'groups').cachePct); } },
  { id: 'q06', shape: 'aggregation', q: 'How many current (not superseded) records in catalog/concepts.jsonl have status "measured"?',
    how: 'count view(concepts) with status == measured', f: d => String(view(jl(d, 'catalog/concepts.jsonl')).filter(r => r.status === 'measured').length) },
  { id: 'q07', shape: 'aggregation', q: 'How many current (not superseded) records in catalog/faults.jsonl have model "tencent/hy4-flash" and class "uncommon"?',
    how: 'count view(faults) with model == tencent/hy4-flash and class == uncommon', f: d => String(view(jl(d, 'catalog/faults.jsonl')).filter(r => r.model === 'tencent/hy4-flash' && r.class === 'uncommon').length) },
  { id: 'q08', shape: 'aggregation', q: 'How many current (not superseded) records in catalog/nomenclature.jsonl have a non-empty "aka" list?',
    how: 'count view(nomenclature) with aka.length > 0', f: d => String(view(jl(d, 'catalog/nomenclature.jsonl')).filter(r => (r.aka || []).length > 0).length) },
  { id: 'q09', shape: 'aggregation', q: 'Add up the "prompt" value of every ledger row ("rows" of each session) in profiles/profile-h12-t5-blue-2026-11-20.json and profiles/profile-h12-t5-green-2026-11-20.json together. What is the total?',
    how: 'sum rows[].prompt over both files', f: d => String([...rows(d, 'profile-h12-t5-blue-2026-11-20'), ...rows(d, 'profile-h12-t5-green-2026-11-20')].reduce((a, r) => a + r.prompt, 0)) },
  { id: 'q10', shape: 'aggregation', q: 'In profiles/profile-live1-2026-11-20.json, how many ledger rows (the "rows" of its session) have a "cached" value above 0?',
    how: 'count rows with cached > 0', f: d => String(rows(d, 'profile-live1-2026-11-20').filter(r => r.cached > 0).length) },
  { id: 'q11', shape: 'locate-then-act', q: 'You must change the status of the concept first recorded with id jjhpvl in catalog/concepts.jsonl. Append-only: which id goes into the "supersedes" field of your new line?',
    how: 'tail of the chain from jjhpvl (the edit is stated, not applied)', f: d => tail(jl(d, 'catalog/concepts.jsonl'), 'jjhpvl').id },
  { id: 'q12', shape: 'locate-then-act', q: 'You must correct the current nomenclature record of the chain that starts at id ilulsh in catalog/nomenclature.jsonl. At which line number (1-based) of the file does that current record sit?',
    how: 'line number of tail(nomenclature, ilulsh) (the edit is stated, not applied)', f: d => { const L = jl(d, 'catalog/nomenclature.jsonl'); return String(line(L, tail(L, 'ilulsh'))); } },
  { id: 'q13', shape: 'locate-then-act', q: 'You must flag the current record of the concept chain that starts at id qysjih in catalog/concepts.jsonl. Give that record as "<id> <line number>" (1-based line in the file).',
    how: 'tail(concepts, qysjih) -> "<id> <line>" (the edit is stated, not applied)', f: d => { const L = jl(d, 'catalog/concepts.jsonl'); const t = tail(L, 'qysjih'); return `${t.id} ${line(L, t)}`; } },
  { id: 'q14', shape: 'locate-then-act', q: 'You must annotate the ledger row with the largest "prompt" in profiles/profile-h12-t5-green-2026-11-20.json. Which row index ("i" field) is it?',
    how: 'argmax rows[].prompt -> .i, unique (the edit is stated, not applied)', f: d => { const R = rows(d, 'profile-h12-t5-green-2026-11-20'); const m = Math.max(...R.map(r => r.prompt)); return String(one(R.filter(r => r.prompt === m), 'max prompt').i); } },
];

export const norm = s => String(s ?? '').toLowerCase().replace(/[`"'*]/g, '').replace(/[.,;:]+$/, '').replace(/\s+/g, ' ').trim();
export function extract(text) { const m = [...String(text ?? '').matchAll(/^\s*\**ANSWER\**\s*:\s*(.+)$/gim)]; return m.length ? m[m.length - 1][1] : null; }
export const score = (corpus, answers) => corpus.map(c => { const a = answers.find(x => x.id === c.id); const got = a ? (a.answer != null ? extract(a.answer) ?? a.answer : null) : null; return { id: c.id, shape: c.shape, expected: c.expected, got, ok: got != null && norm(got) === norm(c.expected) }; });

export function expect(dir) { return QUESTIONS.map(({ f, ...c }) => ({ ...c, q: c.q, prompt: `${PRE}\n\nQuestion: ${c.q}`, expected: norm(f(dir)) })); }

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const cmd = process.argv[2], dir = arg('--dir', 'C:\\wh\\a1data');
  if (cmd === 'build') { for (const f of build(dir)) console.log(`${f.sha256.slice(0, 16)}  ${String(f.bytes).padStart(7)}  ${f.path}`); }
  else if (cmd === 'expect') {
    const out = arg('--out', join(root, 'docs/concepts/results/a1-corpus-2026-11-21.jsonl'));
    const C = expect(dir); mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, C.map(c => JSON.stringify(c)).join('\n') + '\n');
    for (const c of C) console.log(c.id, c.shape.padEnd(15), JSON.stringify(c.expected));
  } else if (cmd === 'score') {
    const corpus = readFileSync(arg('--corpus', join(root, 'docs/concepts/results/a1-corpus-2026-11-21.jsonl')), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const ans = readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const S = score(corpus, ans); for (const s of S) console.log(s.id, s.ok ? 'ok ' : 'NO ', JSON.stringify(s.expected), JSON.stringify(s.got));
    console.log(`solved ${S.filter(s => s.ok).length}/${S.length}`);
  } else console.log('usage: build | expect | score <answers.jsonl>');
}
