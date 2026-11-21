// Text striping (docs/STRIPE.md, reducer id stripe-1.0): contracts S1..S21 as checks, written before app/stripe.js exists.
// Node only: no browser, no provider, no model, no dependency. Run: node scripts/test-stripe.mjs
// Seam: none of the registered seams fits a standalone pure reducer; the join with outstore.present is D1 (deferred, not
// specified here). The interaction checked now is with app/outstore.js (slice, range, present as the head-and-tail baseline).
//
// Readings, where docs/STRIPE.md is ambiguous (the narrowest is used; each is repeated at its check):
//  R1 `kept` of a header pct is the summed length of the decoded kept spans, in UTF-16 units (section 0, decision 15).
//  R2 `k` sketch: a letter is \p{L}, a digit \p{N}, every other non-space char is punctuation; a share is >= 60% of non-space chars.
//  R3 `w` counts \S+ runs and `l` counts "\n" inside the omitted run alone (a word cut by the marker counts in the run).
//  R4 `result.parts` is the same list `parse(result.text).parts` returns.
//  R5 `locate(...).line` is 1-based (the read tool counts lines from 1) and is only checked where every earlier marker carries `l`.
//  R6 policyDigest is taken over the policy object as the caller passed it (sorted-key JSON, minus handle and seen), no defaults merged.
//  R7 header.seen from `parse` is `true` for ` seen` and the earlier percent (number or "N%") for ` seen N%`; falsy when absent.
//  R8 a header-only seen output is the header line, with or without one trailing "\n".
//  R9 in `words` and `chars` mode the keepFirst cap, the 40-char digit rule, the log lead rule and protect spans are the only
//     partial-unit sources, so those are switched off (keepFirst 0, class override prose) or absent from the fixtures.
//  R10 `lines` mode alignment: every omitted run starts and ends at a line boundary (start of text, end of text, next to "\n").
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as O from '../app/outstore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'app', 'stripe.js');
const S = await import(pathToFileURL(MODULE).href).catch(e => ({ missing: String(e.message || e).split('\n')[0] }));

let fails = 0;
const counts = {};
// a check is a function (sync or async): a throw (the module or an export is not there yet) is a failed check, not a stopped suite
const check = async (name, fn) => {
  let ok = false, got = '';
  try { const r = await fn(); ok = r === true; if (!ok) got = typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { got = String(e.message || e).split('\n')[0]; }
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' :: ' + String(got).slice(0, 300)));
  const g = name.split(' ')[0]; counts[g] = (counts[g] || 0) + 1;
  if (!ok) fails++;
};
const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };
const J = v => JSON.stringify(v);
// memoised, and a throw is memoised too, so every check that needs it fails for the same reason
const lazy = fn => { let v, e, done = false; return () => { if (!done) { done = true; try { v = fn(); } catch (x) { e = x; } } if (e) throw e; return v; }; };

// ---- small deterministic tools (seeded PRNG, wrap)
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const pick = (r, a) => a[Math.floor(r() * a.length)];
const wrap = (text, width) => { const out = []; let line = ''; for (const w of text.split(' ')) { if (line && line.length + 1 + w.length > width) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; } if (line) out.push(line); return out.join('\n'); };
const deepFreeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };

// ---- embedded excerpts, verbatim from this repo (LF, no trailing newline), so the suite is stable when the files change
// ---- embedded excerpts: verbatim from this repo, so the suite is stable when the files change (LF line ends, no trailing newline)
const EMB = {
  stems: [
    "# Stems, handles and materialized context (design, 2026-11-19)",
    "",
    "Goal: keep the core context terse and coherent while work runs elsewhere and results arrive asynchronously, reuse provider-held cache entries where that pays, and prove it with token measurements against plain serial turns.",
    "",
    "## 1. Handles (main solution, first)",
    "",
    "- **Opaque short ids** (`k7fq2x`): random base32, no order, no revision suffix, no type prefix. Nothing in an id tells the model what came before, what kind of thing it is, or how often it changed.",
    "- **Re-pointed in the store, never edited in the context.** The id's bytes stay fixed in the cached prefix; what it resolves to changes under it (a stem's progress, its fold, a debugging view, a sealed redaction), per reader and per moment. The model sees state, not that it changed.",
    "- **Pulled, not pushed.** The model is handed ids and resolves what it needs with the read tool it already uses for stored outputs. Its steering point is generic (\"what do these hold now?\"), not a narrative written for it.",
    "- **Steps stay in the turns.** Ids replace only what is bulky or changes (results, progress, folds, logs). Each turn keeps its pertinent step in plain text, tersely: asked, decided, done, open, with ids standing for what is behind it. Without the steps the chain is a bag of ids with nothing to reason along.",
    "- **One mechanism** for wake points, stem points and folds: id + resolver. Stored outputs keep their content-hash handles (`os:`): they never change, so there is nothing to re-point.",
    "- **Audit outside the model.** Per turn the harness logs which ids were resolved and a hash of what each returned, so a review reconstructs exactly what was seen.",
    "",
    "## 2. Stems (git branch + context branch)",
    "",
    "- **Anchor**: the turn where the goal was stated, and main's head at that moment.",
    "- **Context**: a branch session forked at the anchor turn (not the tail), reusing the cached prefix up to it; it carries the goal, its spec and the anchor commit. Its working turns never enter the core line.",
    "- **Git**: `stem/<concern>`; first commit is the spec (checks that fail), then implementation to green; squash with `Goal`, `Anchor`, `Checks`, `Tested-At`; merge after catching up with main.",
    "- **Core line**: holds only the stem's handle. The stem re-points it as it goes (progress before the fold), then to the fold. Folding late costs nothing extra.",
    "- **Catch-up before fold or merge**: only changes that touch the stem's checks or files (from the per-check coverage map) count; none → fold/merge; some → rebase, rerun, then fold/merge.",
    "",
    "## 3. Checkpoints, used when they pay",
    "",
    "A handle point is a candidate cache breakpoint, not an obligation. The harness sets a real breakpoint only where reuse is likely (a stem expected to fold back, a long resolver thread, a hook that will fire again). Each checkpoint's ledger shows its cache write, later reads and net; kinds that never pay are dropped by the steering review.",
    "",
    "### Built (v0.49.0)",
    "",
    "- Kinds: `system` (end of the system prompt and tools), `tail` (the last message), `stem` (a stem's anchor). `settings.bpKinds` switches kinds on and off. Models with explicit breakpoints get them (Claude/Anthropic ids, and the mock's `mock-bp`); others get none and are measured from their reported usage as before.",
    "- The stored log is unchanged; only the request as sent carries `cache_control` parts.",
    "- Accounting (`app/checkpoints.js`, shown under Smells next to the targets): a record per checkpoint, keyed by a hash of the prefix it ends, shared across sessions. A read goes to the deepest known checkpoint the request starts with, so a shallow one pays only when the deeper ones miss (the system checkpoint pays when a new session starts on the same prefix). Writes are split: each new checkpoint owns its own segment. Characters per token are calibrated from each request's own prompt count.",
    "- The mock models breakpoint caching (entries written only at marked points; a request reads the longest written prefix it starts with), so the case studies can run offline.",
    "",
    "## 4. CI records",
    "",
    "On each push: main and git suites always; the machine suite on a schedule or when `app/vm*` changes. Each run posts a commit status and a record (commit, suite, per-check result, failing checks, log tail, modules each check exercised via Playwright coverage). A failure becomes a `ci-failure` concern whose handle the handler re-points as it works: rerun on head first, then the break window filtered by coverage, then bisect; fix forward on main.",
    "",
    "### Passes are silent; failures wait until they matter",
    "",
    "- A check that passes needs no wake: its handle resolves as passed as if it had passed when it ran. No turn is spent on it.",
    "- Until a result exists the handle resolves as pending, never as passed.",
    "- A failure is not delivered as a past event to reason backwards from. It is held behind its handle and addressed when the work in hand touches it (its files, its goal) or when nothing else is running, not as an interruption.",
    "",
    "## 5. Specs first",
    "",
    "Checks are written from the goal before the implementation, assert on state (whDebug, data attributes), not display text, one acceptance check per sentence of the goal. Changing a spec check during implementation is its own commit with a reason.",
    "",
    "## 5b. Confer at checkpoints (cross-causal)",
    "",
    "A stem's continue point is a checkpoint that looks like any other turn but is kept for reuse: its prefix stays cached, so the model can be asked again *as it was then*.",
    "",
    "- **A, ahead (the edge):** the model at the latest turn states what it plans to do next. Terse by default (a few lines); verbose only past a threshold (when B found a divergence, or the plan touches more than one goal).",
    "- **B, look-back (the checkpoint):** the model at the stem's checkpoint, with its own goal in its context, is given the edge turns since then (their step lines and handles, not their bulk) and asked to compare: what the edge did against what it set out to do, and what it would do between.",
    "- **Consult:** A and B together give the intermediate range: drift, skipped steps, goals met by accident, plans that no longer fit. A short consult turn (either side, or a small model) turns that into one correction or \"no change\".",
    "- **A graph, not a pair:** any two checkpoints can confer (an earlier self checks a later one; a later self revisits an earlier goal). Edges are recorded as handles; nothing enters the core line unless the consult changes the plan, and then as one step line.",
    "- **Cost:** B is a cache read of a prefix that already exists plus a small delta; confers are side requests with their own ledger rows, measured like everything else.",
    "",
    "## 6. Micro-context resolver (after 1–5)",
    "",
    "A small helper model takes hints (the core's next question, its recent turns, the handles in view) and chooses, case by case, which handles to materialize at the leading edge of the request and to what. The leading edge reveals the pertinent context; new handles are embedded along the way, so the same approach continues into stems and their own resolution. Its picks are logged with the audit, and it can be switched off per case to compare.",
    "",
    "## 7. Case studies (measure everything against plain serial turns)",
    "",
    "Each case is a scripted scenario (for example: a CI break fixed while the core keeps working), run under:",
    "",
    "| Variant | Core holds |",
    "|---|---|",
    "| S, serial (baseline) | every turn's full text, no handles, no stems |",
    "| A, concrete | event text embedded in turns |",
    "| B, pulled handles | opaque ids, resolved by the model on demand |",
    "| C, + selective checkpoints | B with breakpoints only where reuse is expected |",
    "| D, + stems | C with work in stems, progress and folds behind handles |",
    "| E, + micro resolver | D with the helper choosing what to materialize |",
    "| F, + confer | E with A/B confers at stem checkpoints (cost against drift caught) |",
    "",
    "Per variant, from the ledger: uncached input, cache write, cache read, output tokens, cost, turns, final core size, and **coherence** (scenario assertions that the core acted on the right state: a cheaper variant that loses track fails). Mock provider first (it models a prefix cache), then one cheap and one frontier model. Results as one table per scenario plus totals, published as a page and kept as a regression baseline.",
    "",
    "## 8. Strategies (built, v0.50.0)",
    "",
    "Orchestration is chosen, not hard-wired: a strategy is a named, versioned spec the turn loop reads at fixed seams, picked per session group (the `strategy` setting, through profiles), and recorded on every ledger row.",
    "",
    "- Id: `strat-<name>-<major>.<minor>`. A major version changes what the model sees (turns, handles, tools); a minor one is harness-side tuning only. A changed spec gets a new version; ids are never reused (`register()` refuses).",
    "- Built-ins: `strat-serial-1.0` (the baseline: no explicit checkpoints, no stems), `strat-checkpoint-1.0` (system and tail checkpoints), `strat-stem-1.0` (checkpoints, stems with an anchor checkpoint, pulled handles; the default).",
    "- `strat-serial-2.0` (2026-11-20): serial with ranged reads (`reads: 'ranged'` in the spec). A line range asked of a file (`repo_read` with `lines`) or of a stored output (`output_read` with `lines`, or `offset` and `length` in characters) comes back whole up to 12,000 characters, cut at a line end with a last line naming the lines left out; a tool named inside `run_js` code gets a line saying it is a tool call of its own. The descriptions of `output_read` and `repo_read` differ from 1.0, so it is a major version; every other strategy is sent the definitions it was sent before.",
    "- Seams today: which checkpoint kinds may be set, whether stems may open, handles. Seams to come: confer, the micro resolver, how stems spawn and fold, and per-turn wrappers (a strategy as a handler around the turn).",
    "- Results by strategy and model (requests, cache rate, $/request, smells/request), shown under Smells. This is what routing will read: models slotted into the verticals (stems, resolvers, confers, cores) by measured proficiency under each strategy.",
    "- The case studies (§7) are strategies run on the same scenarios; your own approach becomes one more strategy id in the same comparison.",
    "",
    "## 9. Watcher and operators (v0.51.0)",
    "",
    "- **Watcher** (`watchModel`, per session group): a small free or cheap model checks each tool call as it completes, refusals included, and answers `ok` or `FLAG: <reason>`. A flag goes on the session (`s.flags`) and is a smell, so it is tracked over time and reaches whoever oversees the session. Helper rows `watch` carry its cost.",
    "- **Checked off**: every assessed call is marked (`s.watched[callId] = ok | flag`) and never assessed again; a backfill (`rewatch`) takes only unmarked calls. The operators' CLI follows the same rule: an assessment shows what is new since the last one.",
    "- **Tests never use real models**: every suite and the case-study runner block OpenRouter and fail on any model request. Real models run only in production sessions, driven by operators with turns held and stepped.",
    "- **Operators**: Claude Code sessions on Haiku drive harness sessions (cheap OpenRouter models) through a terse CLI (`scripts/wh.mjs`), assess them, keep them going, and bubble what the harness cannot resolve up to the main session. The OpenRouter key is a credential of the cloud environment: the network proxy adds it, so no session or transcript holds it.",
    "",
    "## Build order",
    "",
    "1. Opaque ids and per-reader resolution in the store; output_read pulls them.",
    "2. Stems: anchor branching, re-pointed handle, fold, catch-up.",
    "3. Selective checkpoints with paid-off accounting.",
    "4. CI workflow, records, coverage map, ci-failure handling; passes resolve silently.",
    "5. Case-study runner (S, A–D).",
    "6. Micro resolver (E), measured against the rest.",
    "7. Confer at checkpoints (F): A/B pairs first, then the graph.",
    "",
    "Each step lands spec first.",
  ].join('\n'),
  claude: [
    "# WebHarness (Glyphharness/web)",
    "",
    "Static ES modules in `app/`, no build: a browser agent harness with sessions, stems, handles and checkpoints.",
    "Work on `dev`; every piece of work follows the rigid order below.",
    "",
    "## Branches",
    "- `dev`: working branch. Keep it releasable.",
    "- `main`: the released site (GitHub Pages, builds in `b/<commit>/`, `version.json`). Release = merge `dev` into `main`, only after the judge passes.",
    "- A clone made for one branch tracks only that branch, and tools then report other branches as \"no remote branch\" or \"unpushed\" after a good push. Once per clone: `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git config push.autoSetupRemote true && git fetch origin`.",
    "",
    "## Agents (`.claude/agents/`)",
    "- `steward.md`: owns the order, delegates, merges catalog inboxes, releases.",
    "- `ui.md`: the page (DOM, styles, slots, cards).",
    "- `seams.md`: seams between modules, spec first (TDD/BDD).",
    "- `context.md`: context features and the concept catalog, per model.",
    "- `judge.md`: reviews against catalog and specs; edits nothing.",
    "- `survey.md`: coarse, token-lean exploration of outside sources; records what it kept and what it deferred.",
    "- `platform.md`: the app-platform concept (wasm-native, protocol-first, time-positional); hypotheses and notes only.",
    "- Start sessions and delegate by agent name from this list; list `.claude/agents/` first and use the newest definitions. Never brief a generic subagent in place of a registered one.",
    "",
    "## Skills (`.claude/skills/`)",
    "- `ui-style/SKILL.md`: append-only rendering, rules, slots, data-* hooks.",
    "- `spec-first/SKILL.md`: failing checks before code.",
    "- `context-experiments/SKILL.md`: production-style sessions and measurements.",
    "- `catalog/SKILL.md`: nomenclature, concepts, faults; inbox writes.",
    "- `turn-analysis/SKILL.md`: describe how sessions and strategies behaved from turn metadata only (existing; read only).",
    "",
    "## Rigid order (every piece of work)",
    "1. Name it (nomenclature) - `context`",
    "2. Concept record (hypothesis) - `context`",
    "3. Spec (failing checks) - `seams`",
    "4. Implement at a seam - `seams` (page work: `ui`)",
    "5. Measure (production-style sessions) - `context`",
    "6. Record result and faults in the catalog - the working agent writes its inbox, `steward` merges",
    "7. Judge - `judge`",
    "8. Release - `steward`",
    "",
    "## Commands (repo root)",
    "- Suites: `node scripts/smoke.mjs`, `scripts/smoke-git.mjs`, `scripts/smoke-vm.mjs` (these need the repo served and a browser). Plain node, no browser: `node scripts/test-cpu-shares.mjs`, `test-paste-keys.mjs`, `test-localbridge.mjs`, `test-validators.mjs` (suite `validators`), `test-profile.mjs` (suite `profile`). Operator CLI against the mock provider (served page and a browser): `node scripts/test-wh.mjs`.",
    "- CI: `node scripts/ci.mjs [main git cpu keys local validators profile wh vm]` (runs in `.github/workflows/test.yml`; a failing suite opens one ci-failure concern, a pass closes it).",
    "- Operator: `node scripts/wh.mjs <cmd>` (init, new, say, sayfile, system, paste, step, stem, fold, ls, show, assess, flags, review, watch, cost, raw, held, dump, log, forget; `node scripts/wh.mjs` prints all). Options `--channel chrome`, `--headed`, `--dir`. Every command is appended to `<dir>/log.jsonl` (sizes and hashes, no message text, no key).",
    "- Case study: `node scripts/casestudy.mjs --live --repeat N`.",
    "- Docs: `docs/STEMS.md`, `docs/TABS.md`, `docs/PROTOCOL.md`, `docs/TESTING.md`, `docs/concepts/`.",
    "",
    "## Non-negotiables",
    "- Tests use the mock provider only; OpenRouter is blocked in tests.",
    "- Secrets never in files or chat.",
    "- No native dialogs (alert/confirm/prompt); use `modal()`.",
    "- Restrictions (allowlists, deny rules, extra gates) are options, off by default. Do not build or enable them upfront; add one when it is wanted as a feature.",
    "- Limits of the session you happen to run in (a cloud session's repository scope, its network proxy) are not product requirements. Do not mirror them in the harness. The control for GitHub access is the token's own repository list.",
    "- Specs before code; a spec change during implementation is its own commit with a reason. Checks cover seams (their contracts) and interactions between seams, not everything; a bug fix is not a concern. Pinning proven seams by hierarchical checksum is a hypothesis (GlyphHarness/next-net-epoch `notes/seam-pinning.md`), not built.",
    "- Catalog via inbox files only (`.claude/skills/catalog/SKILL.md`): agents write `catalog/inbox/<agent>-<shortid>.jsonl`; the steward alone merges into `catalog/*.jsonl`. Records are append-only, one JSON per line.",
  ].join('\n'),
  ci: [
    "// Run the smoke suites and write a record of every check (docs/STEMS.md §4).",
    "// Usage: node scripts/ci.mjs [main] [git] [vm] [--url URL] [--out ci-record.json]",
    "// Exit status 1 when a check fails or a suite stops early.",
    "//",
    "// record: {sha, t, suites: [{suite, ok, ms, checks: [{name, ok}], failed: [names], stopped, tail}]}",
    "import { spawn } from 'node:child_process';",
    "import fs from 'node:fs';",
    "",
    "const args = process.argv.slice(2);",
    "const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };",
    "const url = flag('url', 'http://localhost:8787/'), out = flag('out', 'ci-record.json');",
    "const FILES = { main: 'scripts/smoke.mjs', git: 'scripts/smoke-git.mjs', cpu: 'scripts/test-cpu-shares.mjs', keys: 'scripts/test-paste-keys.mjs', local: 'scripts/test-localbridge.mjs', vm: 'scripts/smoke-vm.mjs', validators: 'scripts/test-validators.mjs', wh: 'scripts/test-wh.mjs', profile: 'scripts/test-profile.mjs', retry: 'scripts/test-retry.mjs' };",
    "const want = args.length ? args : ['main', 'git', 'cpu', 'keys', 'local', 'validators', 'profile', 'retry', 'wh'];",
    "",
    "const run = suite => new Promise(ok => {",
    "  const t0 = Date.now();",
    "  const p = spawn(process.execPath, [FILES[suite], url], { stdio: ['ignore', 'pipe', 'pipe'] });",
    "  let text = '';",
    "  p.stdout.on('data', d => { text += d; process.stdout.write(d); });",
    "  p.stderr.on('data', d => { text += d; process.stderr.write(d); });",
    "  p.on('close', code => {",
    "    const checks = [...text.matchAll(/^(PASS|FAIL) (.+?)(?: [\\[{\"].*)?$/gm)].map(m => ({ name: m[2].trim(), ok: m[1] === 'PASS' }));",
    "    const failed = checks.filter(c => !c.ok).map(c => c.name);",
    "    const stopped = code !== 0 && !failed.length; // ended early (an exception), not a failed check",
    "    ok({ suite, ok: code === 0 && !failed.length, ms: Date.now() - t0, checks, failed, stopped, tail: text.split('\\n').slice(-40).join('\\n') });",
    "  });",
    "});",
    "",
    "const record = { sha: process.env.GITHUB_SHA || '', t: new Date().toISOString(), suites: [] };",
    "for (const s of want) if (FILES[s]) record.suites.push(await run(s));",
    "fs.writeFileSync(out, JSON.stringify(record, null, 1));",
    "const bad = record.suites.filter(s => !s.ok);",
    "console.log(`\\nci: ${record.suites.map(s => `${s.suite} ${s.ok ? 'ok' : 'FAILED'} (${s.checks.filter(c => c.ok).length}/${s.checks.length})`).join(', ')} -> ${out}`);",
    "process.exitCode = bad.length ? 1 : 0;",
  ].join('\n'),
  outstore: [
    "// Output store: the full text of a bulky tool result, kept out of the session",
    "// log under a content handle (os:<hash>). The log gets a short view plus the",
    "// handle; output_read fetches the rest. Nothing is dropped, nothing is re-run.",
    "// Kept in IndexedDB (localStorage is too small); .session exports carry the",
    "// blobs their messages cite.",
    "",
    "const hash = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 31 + c) >>> 0; } return (a.toString(36) + b.toString(36)).slice(0, 10); };",
    "",
    "let dbp;",
    "const db = () => dbp ??= new Promise((ok, no) => {",
    "  const r = indexedDB.open('webharness', 1);",
    "  r.onupgradeneeded = () => r.result.createObjectStore('out');",
    "  r.onsuccess = () => ok(r.result);",
    "  r.onerror = () => no(r.error);",
    "});",
    "const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const r = fn(d.transaction('out', mode).objectStore('out')); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); };",
    "",
    "export const VIEW_MAX = 1500; // chars of a tool result kept in the log before it is stored by handle",
    "",
    "export async function put(text) {",
    "  const handle = 'os:' + hash(text);",
    "  await tx('readwrite', s => s.put(text, handle));",
    "  return handle;",
    "}",
    "// A handle missing here (cleared storage, another device) can come from elsewhere:",
    "// the log repo keeps cited outputs as artifacts. What is fetched is cached again.",
    "let fallback = null;",
    "export const setFallback = f => { fallback = f; };",
    "export async function get(handle) {",
    "  const v = await tx('readonly', s => s.get(handle));",
    "  if (v != null || !fallback || !/^os:[a-z0-9]+$/.test(handle)) return v;",
    "  const r = await fallback(handle).catch(() => null);",
    "  if (typeof r === 'string') await tx('readwrite', s => s.put(r, handle));",
    "  return r ?? v;",
    "}",
    "",
    "// Deterministic noise removal, applied to every tool result before anything else:",
    "// colour codes, trailing spaces, runs of blank lines, and runs of identical lines.",
    "export function squeeze(text) {",
    "  const out = [];",
    "  let prev = null, run = 0;",
    "  const flush = () => { if (run > 1) out.push(`  (previous line x${run})`); };",
    "  for (const raw of text.replace(/\\x1b\\[[0-9;]*[A-Za-z]/g, '').split('\\n')) {",
    "    const l = raw.replace(/\\s+$/, '');",
    "    if (l === prev) { run++; continue; }",
    "    flush();",
    "    if (l === '' && out.at(-1) === '') { prev = l; run = 1; continue; }",
    "    out.push(l); prev = l; run = 1;",
    "  }",
    "  flush();",
    "  return out.join('\\n').trim();",
    "}",
    "",
    "// Lines that mention any word of what the caller said it wants. No model involved.",
    "export function shortlist(text, want, max = 20) {",
    "  const words = String(want).toLowerCase().split(/[^a-z0-9_.-]+/).filter(w => w.length > 2);",
    "  if (!words.length) return null;",
    "  const hits = text.split('\\n').map((l, i) => [i + 1, l]).filter(([, l]) => { const x = l.toLowerCase(); return words.some(w => x.includes(w)); });",
    "  if (!hits.length) return null;",
    "  return { total: hits.length, text: hits.slice(0, max).map(([n, l]) => `${n}: ${l.slice(0, 240)}`).join('\\n') };",
    "}",
    "",
    "// What goes into the log in place of a long result. In order of preference:",
    "//   1. want + helper model: the helper's extract        [os:.. 305L helper]",
    "//   2. want: the matching lines                         [os:.. 305L keywords 1/1]",
    "//   3. head and tail                                    [os:.. 305L ends]",
    "// The whole text is stored first, so every view carries a handle to the rest.",
    "export async function present(raw, { want, helper } = {}) {",
    "  const text = squeeze(raw);",
    "  if (text.length <= VIEW_MAX) return text;",
    "  const handle = await put(text), lines = text.split('\\n').length;",
    "  // One short tag: handle, size, which filter ran. The want itself is already on the call.",
    "  const tag = extra => `[${handle} ${lines}L ${extra}]`;",
    "  if (want) {",
    "    const extract = helper ? await helper(String(want), text).catch(() => null) : null; // a failed helper falls through",
    "    if (extract) return `${tag('helper')}\\n${extract.slice(0, 1200)}`;",
    "    const hits = shortlist(text, want);",
    "    if (hits) return `${tag(`keywords ${Math.min(20, hits.total)}/${hits.total}`)}\\n${hits.text}`;",
    "  }",
    "  return `${tag('ends')}\\n${text.slice(0, 900)}\\n[...]\\n${text.slice(-400)}`;",
    "}",
    "",
    "export async function read({ handle, find, offset = 0, length = 3000, lines }, ranged = false) {",
    "  const text = await get(String(handle || ''));",
    "  if (text == null) return `No stored output \"${handle}\".`;",
    "  return ranged ? range(text, { find, lines, offset, length }) : slice(text, { find, offset, length });",
    "}",
    "// find: matching lines; else a slice from offset",
    "export function slice(text, { find, offset = 0, length = 3000 } = {}) {",
    "  if (find) {",
    "    const hits = text.split('\\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(String(find)));",
    "    return hits.length ? hits.slice(0, 60).map(([n, l]) => `${n}: ${l.slice(0, 300)}`).join('\\n') + (hits.length > 60 ? `\\n[${hits.length - 60} more matches]` : '') : 'No matching lines.';",
    "  }",
    "  const o = Math.max(0, Number(offset) || 0), n = Math.min(4000, Math.max(1, Number(length) || 3000));",
    "  return text.slice(o, o + n) + (o + n < text.length ? `\\n[${text.length - o - n} chars remain; continue at offset ${o + n}]` : '');",
    "}",
    "",
    "// Ranged reads (strategies with reads: 'ranged'): a range that was asked for comes back whole, up to READ_MAX.",
    "export const READ_MAX = 12000; // chars of a requested range returned in one result",
    "// Whole lines starting at line `first`, cut at a line end when over READ_MAX; the last line then says what was left out.",
    "export function capLines(text, first = 1) {",
    "  if (text.length <= READ_MAX) return text;",
    "  const ls = text.split('\\n'), last = first + ls.length - 1;",
    "  let n = 0, size = 0;",
    "  while (n < ls.length && size + ls[n].length + 1 <= READ_MAX) size += ls[n++].length + 1;",
    "  if (!n) return `${ls[0].slice(0, READ_MAX)}\\n[line ${first} is ${ls[0].length} characters: its first ${READ_MAX} are shown${last > first ? `; lines ${first + 1}-${last} not shown: ask for them with lines \"${first + 1}-${last}\"` : ''}]`;",
    "  return `${ls.slice(0, n).join('\\n')}\\n[lines ${first}-${first + n - 1} shown; lines ${first + n}-${last} not shown (${text.length - size} characters): ask for them with lines \"${first + n}-${last}\"]`;",
    "}",
    "// find: matching lines (as slice); lines \"a-b\": those lines, counted from 1; else offset and length, in characters",
    "export function range(text, { find, lines, offset = 0, length = 3000 } = {}) {",
    "  if (find) return slice(text, { find });",
    "  if (lines != null && lines !== '') {",
    "    const all = text.split('\\n'), m = /^\\s*(\\d+)\\s*(?:-\\s*(\\d+)\\s*)?$/.exec(String(lines)), a = Number(m?.[1]);",
    "    if (!m || a < 1) return `lines must be \"a-b\", counted from 1; the text has ${all.length} lines.`;",
    "    if (a > all.length) return `No line ${a}: the text has ${all.length} lines.`;",
    "    return capLines(all.slice(a - 1, Math.max(a, Number(m[2] ?? a))).join('\\n'), a);",
    "  }",
    "  const o = Math.max(0, Number(offset) || 0), n = Math.min(READ_MAX, Math.max(1, Number(length) || 3000));",
    "  return text.slice(o, o + n) + (o + n < text.length ? `\\n[${text.length - o - n} chars remain; continue at offset ${o + n}]` : '');",
    "}",
    "",
    "export const handlesIn =text => String(text || '').match(/os:[a-z0-9]{6,12}/g) || [];",
  ].join('\n'),
  concepts: [
    "{\"id\": \"ndgwdh\", \"name\": \"opaque handles re-pointed under a fixed context\", \"claim\": \"The model sees fixed id bytes while the store re-points what they resolve to.\", \"status\": \"implemented\", \"models\": [{\"model\": \"all\", \"result\": \"implemented\", \"evidence\": \"app/handles.js\"}], \"since\": \"2026-11-19\"}",
    "{\"id\": \"gruwry\", \"name\": \"stems\", \"claim\": \"A branch at the goal's turn leaves the core line with a handle and step lines.\", \"status\": \"implemented\", \"models\": [{\"model\": \"qwen/qwen3.7-flash\", \"result\": \"live x3: +58% cost vs serial after fix, coherent 3/3\", \"evidence\": \"docs/STEMS.md\"}, {\"model\": \"mock\", \"result\": \"cuts core context to about a third\", \"evidence\": \"docs/STEMS.md\"}], \"since\": \"2026-11-19\"}",
    "{\"id\": \"iqmeao\", \"name\": \"selective cache checkpoints\", \"claim\": \"Breakpoints at system, tail and stem anchor lower cost where the provider honours them.\", \"status\": \"implemented\", \"models\": [{\"model\": \"mock breakpoint provider\", \"result\": \"-67..-76% vs serial\", \"evidence\": \"docs/STEMS.md\"}, {\"model\": \"automatic-caching providers\", \"result\": \"no effect\", \"evidence\": \"docs/STEMS.md\"}], \"since\": \"2026-11-19\"}",
    "{\"id\": \"rcmqpq\", \"name\": \"stems inherit the core's upstream\", \"claim\": \"A stem sent to the core's upstream reuses its cache.\", \"status\": \"implemented\", \"models\": [{\"model\": \"live\", \"result\": \"uncached input 55.2k -> 5.2k\", \"evidence\": \"docs/STEMS.md\"}], \"since\": \"2026-11-19\"}",
    "{\"id\": \"xietxd\", \"name\": \"strat-stem-2.0 plain goal framing with low reasoning effort\", \"claim\": \"Plain goal framing plus low effort makes stems cheaper than serial.\", \"status\": \"not-supported\", \"models\": [{\"model\": \"live\", \"result\": \"+81% vs serial; whether the route honours effort is unverified; kept, not discarded\", \"evidence\": \"docs/STEMS.md\"}], \"since\": \"2026-11-19\"}",
    "{\"id\": \"znugko\", \"name\": \"watcher\", \"claim\": \"A small model flags tool calls; failures and repeats are flagged without a model.\", \"status\": \"implemented\", \"models\": [{\"model\": \"liquid/lfm-3-1.7b:free\", \"result\": \"too small for the role: passed a failed call as ok\", \"evidence\": \"catalog/faults.jsonl\"}], \"since\": \"2026-11-19\"}",
    "{\"id\": \"almsdu\", \"name\": \"silent passes, failures wait until they matter\", \"claim\": \"Passing CI is silent; a failure opens one concern and the next pass closes it.\", \"status\": \"implemented\", \"models\": [{\"model\": \"ci\", \"result\": \"implemented in CI only\", \"evidence\": \"scripts/ci.mjs\"}], \"since\": \"2026-11-19\"}",
    "{\"id\": \"dyknfq\", \"name\": \"cache-priming turn\", \"claim\": \"A generic throwaway turn registers the cache for a byte-stable payload without steering.\", \"status\": \"hypothesis\", \"models\": [], \"since\": \"2026-11-19\"}",
  ].join('\n'),
  nomen: [
    "{\"id\":\"dbnrfa\",\"term\":\"graphics baseline\",\"means\":\"Candidate GPU API a shader spec targets (WebGPU, or successor over WebGL); a record with date and evidence docs/platform/survey-A6-A7.md S7.1, 2026-11-21. 'Settled' unproven.\",\"see\":\"docs/platform/look.md\",\"aka\":[],\"since\":\"2026-11-21\",\"supersedes\":\"bgjxqr\"}",
    "{\"id\":\"xtqeuj\",\"term\":\"delegation\",\"means\":\"Scoped, revocable grant the app acts under for its principal; effects name it. Any gate, allowlist or deny rule is an option, off by default.\",\"see\":\"docs/platform/trust.md\",\"aka\":[],\"since\":\"2026-11-21\",\"supersedes\":\"mmcjnk\"}",
    "{\"id\":\"mzqhdl\",\"term\":\"misfire policy\",\"means\":\"Per-trigger rule for ticks missed while a scheduler was down or busy: fire once now, skip to next tick, or fire all missed.\",\"see\":\"docs/platform/survey-A6-A7.md\",\"aka\":[\"catch-up policy\"],\"since\":\"2026-11-21\",\"supersedes\":\"bkrsad\"}",
  ].join('\n'),
  log: [
    "PASS extract: every bullet becomes one step validator record, in file order",
    "PASS extract: a record has the data model fields",
    "PASS extract: a record cites its source path and the lines of its bullet",
    "PASS extract: the same text gives the same records (no model, no clock, no random ids)",
    "PASS extract: a bullet with nothing to look for is kept, with no check and no shape",
    "PASS extract: a checkable record states the step, the expected evidence and the result",
    "PASS extract: a named file or command gives a presence check",
    "PASS extract: two commands joined by \"then\" give an order check",
    "PASS extract: a message with placeholders gives a shape check",
    "PASS extract: what a bullet says never to touch is forbidden evidence, not expected evidence",
    "PASS extract: an amount of money gives a cost check",
    "PASS extract: the check of a record is one of shape, presence, order, cost, or none",
    "PASS extract: the spec-first skill gives one record per list bullet, each citing lines that hash back to it",
    "PASS resolve: one validation result per validator, with the data model fields",
    "PASS resolve: a session whose tool calls show the evidence passes every checkable validator",
    "PASS resolve: a pass points at the turn and the tool call that showed it",
    "PASS resolve: a session that does not show the evidence fails, and every validator still gets its record",
    "PASS resolve: forbidden evidence fails at the call that touched it",
    "PASS resolve: a validator with no shape is unresolved, never passed",
    "PASS resolve: a stale source marks the validator unresolved, not passed, even when the evidence is there",
    "PASS resolve: a source that was not read leaves the validator unresolved",
    "PASS resolve: a profile with argument summaries resolves a path step and a command step",
    "PASS resolve: an old profile without argument summaries stays exactly as unresolved as before",
    "PASS resolve: a record with no tool arguments (a turn profile) leaves what needs them unresolved; cost still resolves",
    "PASS resolve: a failed validation stops nothing (it is a returned record; nothing throws)",
    "PASS resolve: validation by code spends no tokens and no cost",
  ].join('\n'),
  cues: [
    "| cue | C |",
    "| --- | --- |",
    "| unit on a heading line (`#`-heading, ALL-CAPS line of at most 60 chars with 3 or more consecutive capitals, line above `===` or `---`) | 1.0 |",
    "| signal word (error, fail, failed, failure, exception, fatal, warn, warning, todo, fixme, panic, denied, timeout; case-insensitive) | 0.9 |",
    "| identifier: contains `_`, `.`, `/`, `:`, `\\`, `@`, `#`, an inner lower-to-upper step, or letters and digits mixed | 0.8 |",
    "| number: `^\\d[\\d.,:]*$` | 0.7 |",
    "| key: followed by `:` or `\":`, with optional quote | 0.6 |",
    "| line lead in class `log` or `tabular` (first token on the line) | 0.9, and exempt from the later-occurrence fade |",
    "| line lead or first token after a list or heading marker | 0.5 |",
    "| capitalized unit not at the start of its line | 0.3 |",
    "| otherwise | 0 |",
    "",
  ].join('\n'),
  policy: [
    "| key | default | meaning |",
    "| --- | --- | --- |",
    "| `mode` | `auto` | `auto`, `words`, `lines`, `chars` |",
    "| `fraction` | 0.3 | budget as a fraction of n |",
    "| `maxChars` | unset | budget cap in chars (the later integration passes the view size here) |",
    "| `maxTokens`, `cpt` | unset, 4 | token cap, converted by `cpt` chars per token |",
    "| `minKeep` | 2 | minimum kept width |",
    "| `minGap` | 16 (5 in `chars`) | smallest omission worth a marker |",
    "| `gram` | 2 | gram width in `chars` mode |",
    "| `localWeight`, `window`, `segment` | 0.5, 25, 120 | rarity mix and statistics windows |",
    "| `keepFirst`, `keepLast`, `lineCap` | 1, 0, 80 | head and tail lines always kept |",
    "| `protect` | `['os:[a-z0-9]{6,12}']` | regexes (source strings) of spans never cut |",
    "| `detailFrom` | 48 | smallest omission that carries `w`, `l`, `k` |",
    "| `known` | `[]` | terms already in the model's context; damps rarity |",
    "| `class` | unset | class override |",
    "| `handle` | unset | ref for the header (else `fp:` fingerprint) |",
    "| `seen` | `{}` | analyzed-before map (section 5) |",
    "| `maxInput` | off | refuse above n chars (a restriction; off by default, CLAUDE.md) |",
  ].join('\n'),
  prose: [
    "Text striping shrinks a blob of text to a striped skeleton: kept spans interleaved with omission markers that say how much was left out and roughly what kind. A model reading the skeleton gets an idea of what is there, which identifiers and numbers occur, and where to drill in, without reading every token. The full blob stays behind its `os:` handle (tenets 13, 20), so the reduction is lossy only on the wire.",
    "",
    "It is one reducer among others. `outstore.js` already has three (squeeze: noise removal; shortlist: keyword lines; head and tail: `ends`), chosen by what the caller wants (tenet 25). Striping is a fourth, for the case where the caller wants \"what is in here\" and has no keyword and no helper. The policy that chooses it, and the query-surface header that records which reducer was applied, are a later piece (section 10).",
  ].join('\n'),
};

const OS = 'os:7k2m9x3q1a';
const section1 = (() => { const a = EMB.stems.indexOf('## 1.'), b = EMB.stems.indexOf('## 2.'); return EMB.stems.slice(a, b).replace(/\n+$/, ''); })(); // E1: n 1397, 8 lines
const e4 = EMB.outstore.slice(EMB.outstore.indexOf('// find: matching lines'), EMB.outstore.indexOf('// find: matching lines') + 1300);      // E4

// ---- generators (seeded): prose, json lines, log lines, a blob with hapax identifiers and numbers among frequent filler
const FILL = ['the', 'of', 'and', 'to', 'in', 'is', 'that', 'it', 'for', 'with', 'on', 'as', 'was', 'by', 'at', 'are', 'this', 'from'];
const VOCAB = [...FILL, 'handle', 'stored', 'output', 'model', 'view', 'marker', 'budget', 'session', 'result', 'strategy', 'cache', 'prefix', 'turn', 'read', 'tool', 'record', 'concept', 'check', 'suite', 'seam', 'span', 'kept', 'omitted', 'text', 'line', 'rare', 'common'];
const genProse = (seed, sentences) => {
  const r = rng(seed), paras = []; let cur = [];
  for (let i = 0; i < sentences; i++) {
    const w = []; const k = 8 + Math.floor(r() * 7);
    for (let j = 0; j < k; j++) w.push(pick(r, VOCAB));
    w[0] = w[0][0].toUpperCase() + w[0].slice(1); cur.push(w.join(' ') + '.');
    if (cur.length === 4) { paras.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) paras.push(cur.join(' '));
  return paras.join('\n\n');
};
const genJson = (seed, n) => {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) out.push(`{"id":"${(100000 + i * 37 + seed).toString(36)}","term":"${pick(r, VOCAB)} ${pick(r, VOCAB)}","means":"${Array.from({ length: 12 }, () => pick(r, VOCAB)).join(' ')}","see":"docs/${pick(r, VOCAB)}.md","since":"2026-11-21"}`);
  return out.join('\n');
};
const genLog = (seed, n) => {
  const r = rng(seed), out = [], lv = ['INFO', 'WARN', 'ERROR', 'DEBUG'], vb = ['handled', 'queued', 'retried', 'closed', 'opened', 'flushed'];
  for (let i = 0; i < n; i++) out.push(`2026-11-21T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}Z ${pick(r, lv)} worker-${Math.floor(r() * 8)} ${pick(r, vb)} req ${1000 + Math.floor(r() * 9000)} in ${Math.floor(r() * 400)} ms ${r() < 0.2 ? 'error: timeout on /api/v1/item/' + i : 'ok'}`);
  return out.join('\n');
};
const genPass = (seed, n) => {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) out.push(`${r() < 0.9 ? 'PASS' : 'FAIL'} ${pick(r, VOCAB)}: ${Array.from({ length: 4 + Math.floor(r() * 9) }, () => pick(r, VOCAB)).join(' ')}`);
  return out.join('\n');
};
// hapax identifiers (df 1) and numbers (df 1) among frequent filler; lines stay under 80 chars
const genBlob = (seed, nLines = 300) => {
  const r = rng(seed), ids = [], nums = [], lines = [];
  for (let i = 0; i < nLines; i++) {
    const w = [], k = 6 + Math.floor(r() * 5);
    for (let j = 0; j < k; j++) w.push(pick(r, FILL));
    if (i % 2 === 0) {
      const id = 'sess_' + i.toString(36).padStart(2, '0') + ((seed * 131 + i * 17) % 1296).toString(36).padStart(2, '0');
      const num = String(10007 + i * 13 + Math.floor(r() * 9));
      ids.push(id); nums.push(num);
      w.splice(Math.floor(r() * w.length), 0, id); w.splice(Math.floor(r() * w.length), 0, 'took', num, 'ms');
    }
    lines.push(w.join(' '));
  }
  return { text: lines.join('\n'), ids, nums };
};

// ---- the corpus: repo excerpts, windows over them, generated logs, json, prose, blobs (S4 asks for at least 50)
const corpus = lazy(() => {
  const c = [], add = (name, text) => c.push({ name, text });
  for (const k of Object.keys(EMB)) add(k, EMB[k]);
  add('stems-s1', section1); add('outstore-e4', e4);
  for (let i = 0; i < 8; i++) add('stems-w' + i, EMB.stems.slice(i * 1400, i * 1400 + 2200));
  for (let i = 0; i < 3; i++) add('claude-w' + i, EMB.claude.slice(i * 1500, i * 1500 + 2000));
  for (let i = 0; i < 4; i++) add('outstore-w' + i, EMB.outstore.slice(i * 1700, i * 1700 + 2200));
  for (let s = 1; s <= 6; s++) { add('gen-log-' + s, genLog(s, 40)); add('gen-json-' + s, genJson(s, 12)); add('gen-prose-' + s, genProse(s, 18)); add('gen-blob-' + s, genBlob(s, 120).text); }
  add('gen-wrapped', wrap(genProse(9, 30).replace(/\n\n/g, ' '), 70)); add('gen-pass', genPass(3, 40));
  return c;
});

// ---- an independent decoder of the notation (docs/STRIPE.md section 1), used to judge the module's output without trusting parse
const HEADER = /^\[(os:[a-z0-9]{6,12}|fp:[0-9a-z]{10}) (\d+)L (stripe-\d+\.\d+) ([\x21-\x5c\x5e-\x7e]+) (\d+)%( seen( \d+%)?)?\]$/;
const MARK = /\[~(\d+)((?:,(?:w\d+|l\d+|k[adpsm]))*)\]/y;
const decode = out => {
  const nl = out.indexOf('\n'), head = nl < 0 ? out : out.slice(0, nl), body = nl < 0 ? '' : out.slice(nl + 1), hm = HEADER.exec(head);
  if (!hm) throw new Error('header does not match: ' + head.slice(0, 90));
  const parts = []; let cur = '', i = 0;
  const flush = () => { if (cur) parts.push({ kept: cur }); cur = ''; };
  while (i < body.length) {
    if (body.startsWith('[~~', i)) { cur += '[~'; i += 3; continue; }
    if (body.startsWith('[~', i)) {
      MARK.lastIndex = i; const m = MARK.exec(body);
      if (!m) throw new Error('stray [~ at body offset ' + i);
      flush(); const o = { n: +m[1] }, order = [];
      for (const d of m[2].split(',').filter(Boolean)) { order.push(d[0]); if (d[0] === 'w') o.w = +d.slice(1); else if (d[0] === 'l') o.l = +d.slice(1); else o.k = d[1]; }
      parts.push({ omit: o, raw: m[0], order }); i += m[0].length; continue;
    }
    cur += body[i++];
  }
  flush();
  let pos = 0, kept = 0;
  for (const p of parts) { p.start = pos; const len = p.kept != null ? p.kept.length : p.omit.n; if (p.kept != null) kept += len; pos += len; p.end = pos; }
  return { head, hm, parts, total: pos, kept, seen: hm[6] };
};
const norm = parts => parts.map(p => p.kept != null ? { kept: p.kept } : { omit: { ...p.omit } });
const keptIv = d => d.parts.filter(p => p.kept != null).map(p => [p.start, p.end]);
const omits = d => d.parts.filter(p => p.omit);
const covers = (iv, a, b) => iv.some(([s, e]) => s <= a && e >= b);
const overlaps = (iv, a, b) => iv.some(([s, e]) => s < b && a < e);
// what a marker must say about the omitted run (readings R2, R3)
const sketch = run => {
  let a = 0, d = 0, p = 0, t = 0;
  for (const ch of run) { if (/\s/.test(ch)) continue; t++; if (/\p{L}/u.test(ch)) a++; else if (/\p{N}/u.test(ch)) d++; else p++; }
  if (!t) return 's'; if (a * 100 >= 60 * t) return 'a'; if (d * 100 >= 60 * t) return 'd'; if (p * 100 >= 60 * t) return 'p'; return 'm';
};
const expect = run => { const o = {}, w = (run.match(/\S+/g) || []).length, l = run.split('\n').length - 1; if (w >= 1) o.w = w; if (l >= 1) o.l = l; o.k = sketch(run); return o; };
// null when the decoded skeleton reproduces the source: kept spans equal the source at their offsets and the offsets sum to n
const reproduces = (src, d) => {
  for (const p of d.parts) if (p.kept != null && src.slice(p.start, p.end) !== p.kept) return 'kept span differs at offset ' + p.start;
  return d.total === src.length ? null : `offsets sum to ${d.total}, n is ${src.length}`;
};
const detailProblems = (src, d, detailFrom = 48) => {
  const bad = [];
  for (const p of omits(d)) {
    const run = src.slice(p.start, p.end);
    if (p.omit.n < detailFrom) { if (p.order.length) bad.push(`detail below detailFrom at ${p.start}: ${p.raw}`); continue; }
    const e = expect(run), g = p.omit;
    if (e.w !== g.w || e.l !== g.l || e.k !== g.k) bad.push(`${p.raw} at ${p.start}, expected ${J(e)}`);
    if (p.order.join('') !== ['w', 'l', 'k'].filter(x => e[x] != null).join('')) bad.push(`order ${p.raw}`);
  }
  return bad;
};
const PROT = ['os:[a-z0-9]{6,12}'];
const protIv = (src, res = PROT) => res.flatMap(re => [...src.matchAll(new RegExp(re, 'g'))].map(m => [m.index, m.index + m[0].length]));
const UNIT = /[\p{L}\p{N}_]+(?:[./:\\@#-][\p{L}\p{N}_]+)*/gu;
const unitIv = src => [...src.matchAll(UNIT)].map(m => [m.index, m.index + m[0].length]);
const lineOf = (src, off) => src.slice(0, off).split('\n').length; // 1-based
const MODES = ['auto', 'words', 'lines', 'chars'], BUDGETS = [0.1, 0.2, 0.3, 0.5, 0.7];
const strip = (t, p = {}) => S.stripe(t, { handle: OS, ...p });

// every corpus input at every mode and budget, decoded once
const runs = lazy(() => {
  const rs = [];
  for (const { name, text } of corpus()) for (const mode of MODES) for (const b of BUDGETS) {
    const r = strip(text, { mode, fraction: b });
    let dec = null, err = null; try { dec = decode(r.text); } catch (e) { err = String(e.message || e); }
    rs.push({ name, src: text, mode, b, r, dec, err });
  }
  return rs;
});
const firstBad = (list, bad) => { for (const x of list) { const w = bad(x); if (w) return `${x.name} ${x.mode} ${x.b}: ${w}`; } return true; };

// ============================================================ S1 Pure
await check('S1 pure: two calls with equal inputs return deep-equal results', () => {
  for (const { name, text } of corpus().slice(0, 12)) for (const p of [{}, { mode: 'words', fraction: 0.2 }, { mode: 'lines', maxChars: 500 }, { mode: 'chars', fraction: 0.5 }]) {
    if (!same(strip(text, p), strip(text, p))) return name + ' ' + J(p);
  }
  return true;
});
await check('S1 pure: calls on other inputs in between do not change the bytes of a result', () => {
  const a = strip(EMB.stems), b1 = strip(EMB.claude, { mode: 'chars' }), b2 = strip(EMB.log, { fraction: 0.1 }), a2 = strip(EMB.stems);
  return same(a, a2) && b1.text.length > 0 && b2.text.length > 0;
});
await check('S1 pure: the input string, a frozen policy (arrays and maps inside) and DEFAULTS are not mutated', () => {
  const before = J(S.DEFAULTS), p = deepFreeze({ fraction: 0.2, protect: ['os:[a-z0-9]{6,12}', 'q\\d+'], known: ['handle', 'budget'], seen: { [OS]: { rid: 'stripe-1.0', policyDigest: 'x', pct: 5, class: 'prose' } }, handle: OS });
  const text = EMB.stems, copy = text.slice(); // strings are immutable; the frozen policy would make a write throw (modules are strict)
  S.stripe(text, p); S.stripe(text, { ...p, mode: 'chars' });
  return text === copy && J(S.DEFAULTS) === before && J(p) === J(deepFreeze({ fraction: 0.2, protect: ['os:[a-z0-9]{6,12}', 'q\\d+'], known: ['handle', 'budget'], seen: { [OS]: { rid: 'stripe-1.0', policyDigest: 'x', pct: 5, class: 'prose' } }, handle: OS }));
});
await check('S1 pure: policy key order does not change the output', () => {
  const p1 = { handle: OS, fraction: 0.2, mode: 'words', minGap: 20, minKeep: 3, keepFirst: 2, detailFrom: 60 };
  const p2 = Object.fromEntries(Object.entries(p1).reverse());
  return same(S.stripe(EMB.claude, p1), S.stripe(EMB.claude, p2)) && same(S.stripe(EMB.log, p1), S.stripe(EMB.log, p2));
});
await check('S1 pure: parse, verify, classify, fingerprint and locate return equal values on equal arguments', () => {
  const t = EMB.stems, r = strip(t), a = S.parse(r.text), b = S.parse(r.text);
  return same(a, b) && S.verify(t, a) === S.verify(t, b) && same(S.classify(t), S.classify(t)) && S.fingerprint(t) === S.fingerprint(t) && same(S.locate(a, 0), S.locate(b, 0));
});

// ============================================================ S2 Identity
// the budget is min(maxChars, fraction * n, maxTokens * cpt) and fraction always counts (default 0.3), so fraction 1 is set in each case (R11)
await check('S2 identity: n <= budget returns the text itself, reduced false, no header (fraction 1 with maxChars or maxTokens)', () => {
  for (const t of [EMB.prose, EMB.log, 'short text', EMB.nomen]) for (const p of [{ fraction: 1, maxChars: t.length }, { fraction: 1, maxChars: t.length + 1000 }, { fraction: 1 }, { fraction: 1, maxTokens: Math.ceil(t.length / 4) }]) {
    const r = strip(t, p);
    if (r.text !== t || r.reduced !== false || r.n !== t.length) return `${t.slice(0, 12)} ${J(p)} -> ${J({ reduced: r.reduced, n: r.n })}`;
  }
  return true;
});
await check('S2 identity: the empty string comes back empty and unreduced', () => { const r = strip(''); return r.text === '' && r.reduced === false; });
await check('S2 identity: a skeleton is returned unchanged, byte for byte, at any smaller budget, mode or handle (idempotent)', () => {
  for (const mode of MODES) {
    const r = strip(EMB.stems, { mode, fraction: 0.3 });
    if (!r.reduced) return 'first pass not reduced';
    for (const p of [{ fraction: 0.1 }, { mode: 'chars', fraction: 0.05 }, { handle: 'os:abcdef123456', maxChars: 200 }, {}]) {
      const r2 = S.stripe(r.text, p);
      if (r2.text !== r.text || r2.reduced !== false) return mode + ' ' + J(p);
    }
  }
  return true;
});
await check('S2 identity: a header-only seen output is a skeleton too and is returned unchanged', () => {
  const head = strip(EMB.stems).text.split('\n')[0], h = head.slice(0, -1) + ' seen]';
  return S.stripe(h, { fraction: 0.1 }).text === h;
});
await check('S2 identity: a text that begins with a header line but is not a skeleton is returned unchanged (decision 11)', () => {
  const t = '[os:7k2m9x3q1a 3L stripe-1.0 prose 10%]\n' + genProse(4, 20), r = S.stripe(t, { fraction: 0.1 });
  return r.text === t && r.reduced === false;
});
await check('S2 identity: a text that begins like a marker or a bracket line but not like a header is reduced, not returned as is', () => {
  const t = '[~12] literal start\n' + genProse(5, 20) + '\n[note] other', r = strip(t, { fraction: 0.2 });
  return r.reduced === true && r.text !== t && HEADER.test(r.text.split('\n')[0]);
});

// ============================================================ S3 Header grammar
await check('S3 header: the first line of every reduced output matches the header grammar exactly, one line, at most 80 chars with a handle', () =>
  firstBad(runs(), x => !x.r.reduced ? 'not reduced' : x.err ? x.err : !HEADER.test(x.dec.head) || x.dec.head.includes('\n') ? x.dec.head : x.dec.head.length > 80 ? 'header over 80: ' + x.dec.head.length : null));
await check('S3 header: rid equals ID, lines equals the source line count, n and class agree with the header', () =>
  S.ID === 'stripe-1.0' && firstBad(runs(), x => x.dec.hm[3] !== S.ID || x.r.rid !== S.ID ? 'rid' : +x.dec.hm[2] !== x.src.split('\n').length ? `lines ${x.dec.hm[2]} vs ${x.src.split('\n').length}` : x.r.n !== x.src.length ? 'n' : x.r.class !== x.dec.hm[4] ? 'class' : x.dec.hm[1] !== OS ? 'ref' : null));
await check('S3 header: lines counts a trailing newline as one more line', () => {
  for (const t of [EMB.stems, EMB.stems + '\n', EMB.log + '\n\n']) { const d = decode(strip(t).text); if (+d.hm[2] !== t.split('\n').length) return J([+d.hm[2], t.split('\n').length]); }
  return true;
});
await check('S3 header: pct equals round(100 * kept / n), kept being the decoded kept length in UTF-16 units (R1)', () =>
  firstBad(runs(), x => +x.dec.hm[5] !== Math.round(100 * x.dec.kept / x.src.length) ? `pct ${x.dec.hm[5]} vs ${Math.round(100 * x.dec.kept / x.src.length)}` : null));
await check('S3 header: with no handle the ref is fp: and ten base36 chars, still one line', () => {
  const r = S.stripe(EMB.stems, { fraction: 0.2 }), d = decode(r.text);
  return /^fp:[0-9a-z]{10}$/.test(d.hm[1]) && !d.head.includes('\n');
});

// ============================================================ S4 Parse-back
await check('S4 parse-back: the corpus has at least 50 distinct inputs of at least 5 classes', () => {
  const c = corpus(), labels = new Set(c.map(x => S.classify(x.text).label));
  return c.length >= 50 && new Set(c.map(x => x.text)).size === c.length && labels.size >= 5 || J({ n: c.length, labels: [...labels] });
});
await check('S4 parse-back: every corpus input at every mode and budget (0.1 .. 0.7) is reduced and verify(input, parse(output)) is true', () =>
  firstBad(runs(), x => !x.r.reduced ? 'not reduced' : S.verify(x.src, S.parse(x.r.text)) !== true ? 'verify false' : null));
await check('S4 parse-back: an independent decoder agrees: kept spans equal the source at their offsets and the offsets sum to n', () =>
  firstBad(runs(), x => x.err || reproduces(x.src, x.dec)));
await check('S4 parse-back: parse returns the same kept strings and marker fields as the independent decoder', () =>
  firstBad(runs(), x => same(norm(S.parse(x.r.text).parts), norm(x.dec.parts)) ? null : 'parts differ'));
await check('S4 parse-back: result.parts is the list parse(result.text).parts returns (R4)', () =>
  firstBad(runs().filter((_, i) => i % 7 === 0), x => same(x.r.parts, S.parse(x.r.text).parts) ? null : 'parts differ'));
await check('S4 parse-back: verify is false when a kept span, a marker count or the source length is wrong', () => {
  const src = EMB.stems, out = strip(src, { fraction: 0.3 }).text, d = decode(out);
  const k = d.parts.find(p => p.kept && p.kept.length >= 4), m = d.parts.find(p => p.omit);
  const flipped = src.slice(0, k.start + 1) + (src[k.start + 1] === 'q' ? 'z' : 'q') + src.slice(k.start + 2);
  const bumpedOut = out.replace(m.raw, m.raw.replace(/^\[~(\d+)/, (_, n) => '[~' + (+n + 1)));
  return S.verify(src, S.parse(out)) === true && S.verify(flipped, S.parse(out)) === false && S.verify(src, S.parse(bumpedOut)) === false && S.verify(src + 'x', S.parse(out)) === false;
});

// ============================================================ S5 Marker grammar
await check('S5 marker: every marker matches the grammar, details in the order w, l, k, counts at least 1', () =>
  firstBad(runs(), x => { for (const p of omits(x.dec)) if (!/^\[~\d+(?:,w\d+)?(?:,l\d+)?(?:,k[adpsm])?\]$/.test(p.raw) || p.omit.n < 1) return p.raw; return null; }));
await check('S5 marker: below detailFrom (48) a marker is bare, from it on it carries k, and w, l, k equal the recomputation from the omitted run (R2, R3)', () =>
  firstBad(runs(), x => detailProblems(x.src, x.dec)[0] || (omits(x.dec).some(p => p.omit.n >= 48 && p.omit.k == null) ? 'no k at 48+' : null)));
await check('S5 marker: the detailFrom policy moves the threshold (10) and a huge one makes every marker bare', () => {
  const src = EMB.stems, d10 = decode(strip(src, { detailFrom: 10 }).text), dBig = decode(strip(src, { detailFrom: 1e9 }).text);
  return detailProblems(src, d10, 10).length === 0 && omits(d10).some(p => p.omit.n >= 10 && p.omit.n < 48 && p.omit.k) && omits(dBig).every(p => p.order.length === 0);
});
await check('S5 marker: no two markers are adjacent and no kept span is empty', () =>
  firstBad(runs(), x => x.dec.parts.some((p, i) => i && (p.omit != null) === (x.dec.parts[i - 1].omit != null)) || S.parse(x.r.text).parts.some(p => p.kept === '') ? 'adjacent or empty' : null));
await check('S5 marker: whitespace-only, digit-heavy and punctuation-heavy omitted runs get kind s, d and p', () => {
  const pad = (s, n) => s.repeat(n), keep = 'KEEP' + 'one two three ';
  const src = keep + pad(' ', 70) + ' MID1 ' + pad('0123456789', 12) + ' MID2 ' + pad('.,;:!?-=+', 14) + ' MID3 ' + pad('abc ', 40) + ' end of text kept';
  const d = decode(S.stripe(src, { handle: OS, maxChars: 150, protect: ['KEEP', 'MID\\d', 'end of text kept'], keepFirst: 0 }).text);
  const ks = omits(d).filter(p => p.omit.n >= 48).map(p => p.omit.k);
  return reproduces(src, d) === null && ks.includes('s') && ks.includes('d') && ks.includes('p') && ks.includes('a') || J(ks);
});

// ============================================================ S6 Escape round-trip
const HEAD = '[os:7k2m9x3q1a 3L stripe-1.0 prose 10%]';
const fill = (seed, n) => genProse(seed, n).replace(/\n\n/g, ' ');
await check('S6 escape: literal marker-like text (tilde-12 in brackets, double tilde, tilde before a non-digit) decodes back and is written escaped', () => {
  const sentence = 'note: the marker form [~12] is literal here, and [~~ too, then [~x as well.', src = fill(21, 8) + ' ' + sentence + ' ' + fill(22, 8);
  const out = S.stripe(src, { handle: OS, maxChars: 220, protect: ['\\[~12\\]', '\\[~~', '\\[~x', 'os:[a-z0-9]{6,12}'] }).text, d = decode(out), p = S.parse(out);
  const joined = p.parts.filter(x => x.kept != null).map(x => x.kept).join('|');
  return out.includes('[~~12]') && out.includes('[~~~') && out.includes('[~~x') && reproduces(src, d) === null && S.verify(src, p) === true && joined.includes('[~12]') && joined.includes('[~~') && joined.includes('[~x');
});
await check('S6 escape: a kept span that ends in an open bracket right before a marker keeps the bracket and decodes back', () => {
  const src = fill(23, 10) + ' xx[' + fill(24, 10), out = S.stripe(src, { handle: OS, maxChars: 150, protect: ['xx\\[', 'os:[a-z0-9]{6,12}'] }).text;
  return /xx\[\[~\d/.test(out) && reproduces(src, decode(out)) === null && S.verify(src, S.parse(out)) === true;
});
await check('S6 escape: a kept span that ends in bracket-tilde right before a marker is escaped and decodes back', () => {
  const src = fill(25, 10) + ' q[~' + fill(26, 10), out = S.stripe(src, { handle: OS, maxChars: 150, protect: ['q\\[~', 'os:[a-z0-9]{6,12}'] }).text;
  return /q\[~~\[~\d/.test(out) && reproduces(src, decode(out)) === null && S.verify(src, S.parse(out)) === true;
});
await check('S6 escape: 40 seeded texts over the alphabet of brackets, tildes, digits and letters decode back exactly at every mode and budget', () => {
  const alpha = ['[', '~', ']', '0', '1', '2', ' ', 'a', 'b', ',', 'w', 'k', '['];
  for (let s = 1; s <= 40; s++) {
    const r = rng(1000 + s); let src = ''; for (let i = 0; i < 500; i++) src += pick(r, alpha);
    for (const mode of MODES) for (const b of [0.2, 0.5]) {
      const out = strip(src, { mode, fraction: b }).text;
      let d; try { d = decode(out); } catch (e) { return `seed ${s} ${mode} ${b}: ${e.message}`; }
      if (reproduces(src, d) !== null || S.verify(src, S.parse(out)) !== true) return `seed ${s} ${mode} ${b}`;
    }
  }
  return true;
});
await check('S6 escape: a stray tilde-bracket, an unterminated marker or a malformed marker in a skeleton makes parse throw', () => {
  if (typeof S.parse !== 'function') return 'parse is not exported';
  S.parse(HEAD + '\nab cd'); // a well-formed skeleton does not throw
  const bad = ['ab [~x cd', 'ab [~', 'ab [~12 cd', 'ab [~12,x]', 'ab [~1a]', 'ab [~,w3]'];
  for (const b of bad) { let threw = false; try { S.parse(HEAD + '\n' + b); } catch { threw = true; } if (!threw) return b; }
  return true;
});
await check('S6 escape: golden grammar literals (parse): double tilde is one tilde, a counted marker is an omission, a lone bracket before a marker is text', () => {
  const p = S.parse(HEAD + '\nab[~~12] cd[~129,w27,l1,ka]ef[~5]'), q = S.parse(HEAD + '\nxx[[~266]'), r = S.parse(HEAD + '\n[~~~'), t = S.parse(HEAD + '\n[~~12]');
  return same(norm(p.parts), [{ kept: 'ab[~12] cd' }, { omit: { n: 129, w: 27, l: 1, k: 'a' } }, { kept: 'ef' }, { omit: { n: 5 } }])
    && same(norm(q.parts), [{ kept: 'xx[' }, { omit: { n: 266 } }]) && same(norm(r.parts), [{ kept: '[~~' }]) && same(norm(t.parts), [{ kept: '[~12]' }]) && !!p.header
    && S.locate(p, 0).offset === 0 && S.locate(p, 1).offset === 139;
});

// ============================================================ S7 Budget
// R11: the budget is min(maxChars, fraction * n, maxTokens * cpt), fraction always counting (default 0.3); floorLength is the length of the
//      skeleton the module returns for the same text and policy at maxChars 1 (section 2.1: below the floor the output is the floor skeleton).
// R12: with no protect match, that floor skeleton has no kept span: header, "\n", one marker for the whole text (soft keeps yield first).
const budgetOf = (n, p = {}) => Math.min(p.maxChars ?? Infinity, (p.fraction ?? 0.3) * n, p.maxTokens != null ? p.maxTokens * (p.cpt ?? 4) : Infinity);
const floorOf = (src, p = {}) => strip(src, { ...p, maxChars: 1 }).text.length;
const s7problem = (src, p) => {
  const r = strip(src, p), b = budgetOf(src.length, p);
  if (src.length <= b) return r.text === src && r.reduced === false ? null : 'identity expected';
  if (r.reduced !== true) return 'not reduced above budget';
  const f = floorOf(src, p);
  return r.text.length <= Math.max(b, f) ? null : `length ${r.text.length} > max(budget ${b}, floor ${f})`;
};
await check('S7 budget: output length <= max(budget, floor) over the corpus at every mode and budget fraction', () =>
  firstBad(runs(), x => x.r.text.length > Math.max(budgetOf(x.src.length, { fraction: x.b }), floorOf(x.src, { mode: x.mode, fraction: x.b })) ? `${x.r.text.length} > budget ${budgetOf(x.src.length, { fraction: x.b })}` : null));
await check('S7 budget: maxChars, maxTokens with cpt and fraction combine as a minimum', () => {
  const src = EMB.claude, n = src.length;
  for (const p of [{ maxChars: 300 }, { maxChars: 300, fraction: 0.9 }, { maxTokens: 60 }, { maxTokens: 50, cpt: 3 }, { fraction: 0.05, maxChars: 900 }, { maxChars: 500, maxTokens: 100 }, { maxChars: 700, maxTokens: 100, cpt: 2, fraction: 0.5 }]) {
    const w = s7problem(src, p); if (w) return J(p) + ' ' + w;
    const out = strip(src, p).text, b = budgetOf(n, p);
    if (b >= 300 && out.length <= b * 0.3) return J(p) + ': output ' + out.length + ' is far below budget ' + b; // the budget is used, not only respected
  }
  return true;
});
await check('S7 budget: with no protect match the floor skeleton is a header and one marker for the whole text', () => {
  for (const mode of MODES) for (const src of [EMB.claude, EMB.log, genProse(7, 30), genBlob(7, 80).text]) {
    if (protIv(src).length) continue;
    const d = decode(strip(src, { mode, maxChars: 1 }).text);
    if (d.parts.length !== 1 || !d.parts[0].omit || d.parts[0].omit.n !== src.length) return mode + ' ' + J(d.parts.map(p => p.omit || p.kept.length));
  }
  return true;
});
await check('S7 budget: the floor skeleton keeps every protected span whole, and nothing else (soft keeps yield first)', () => {
  const src = genProse(8, 30).split('\n\n').map((p, i) => i === 2 ? p + ' see os:abc123def456 here' : i === 5 ? 'os:q1w2e3r4t5y6 ' + p : p).join('\n\n');
  const d = decode(strip(src, { maxChars: 1 }).text), iv = protIv(src);
  return iv.length === 2 && reproduces(src, d) === null && d.parts.filter(p => p.kept != null).length === 2 && iv.every(([a, b]) => covers(keptIv(d), a, b)) && d.parts.filter(p => p.kept != null).every(p => /^os:[a-z0-9]{12}$/.test(p.kept));
});
await check('S7 budget: the header counts inside the budget (a budget under the header plus one marker gives the floor, not a shorter text)', () => {
  const src = EMB.stems, f = floorOf(src), r = strip(src, { maxChars: Math.max(1, f - 10) });
  return r.reduced === true && r.text.length === f;
});
await check('S7 budget: a larger budget keeps strictly more on inputs of 2000 chars or more (the budget is spent, nesting makes it monotone)', () => {
  for (const { name, text } of corpus().filter(c => c.text.length >= 2000)) for (const mode of MODES) {
    const lo = decode(strip(text, { mode, fraction: 0.1 }).text).kept, hi = decode(strip(text, { mode, fraction: 0.7 }).text).kept;
    if (!(hi > lo)) return `${name} ${mode}: ${lo} -> ${hi}`;
  }
  return true;
});

// ============================================================ S8 Nesting
const keptOf = (res, src) => res.reduced ? keptIv(decode(res.text)) : [[0, src.length]];
const nested = (a, b) => { for (const [s, e] of a) if (!covers(b, s, e)) return [s, e]; return null; };
await check('S8 nesting: for budget fractions 0.1 < 0.2 < 0.3 < 0.5 < 0.7 the kept positions of each output are inside the next, every mode, whole corpus', () => {
  const by = new Map();
  for (const x of runs()) { const k = x.name + ' ' + x.mode; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  for (const [k, xs] of by) { xs.sort((a, b) => a.b - b.b); for (let i = 1; i < xs.length; i++) { const bad = nested(keptIv(xs[i - 1].dec), keptIv(xs[i].dec)); if (bad) return `${k} ${xs[i - 1].b} -> ${xs[i].b} at ${bad}`; } }
  return true;
});
await check('S8 nesting: the same holds on a maxChars ladder with other policies (keepFirst, keepLast, minGap, known)', () => {
  const policies = [{}, { mode: 'words' }, { mode: 'lines' }, { mode: 'chars' }, { keepFirst: 0, keepLast: 2 }, { minGap: 30, minKeep: 4 }, { known: ['handle', 'budget', 'stored'] }];
  for (const src of [EMB.stems, EMB.log, EMB.outstore, genJson(3, 40), EMB.claude]) for (const p of policies) {
    const rs = [150, 300, 600, 1200, 2400].map(m => [m, strip(src, { ...p, fraction: 1, maxChars: m })]);
    for (let i = 1; i < rs.length; i++) { const bad = nested(keptOf(rs[i - 1][1], src), keptOf(rs[i][1], src)); if (bad) return `${J(p)} ${rs[i - 1][0]} -> ${rs[i][0]} at ${bad}`; }
  }
  return true;
});
await check('S8 nesting: protected spans stay kept at every rung of the ladder (the floor is the first rung)', () => {
  const src = genProse(11, 40).split('\n\n').map((p, i) => i === 3 ? p + ' see os:abc123def456 here' : p).join('\n\n'), iv = protIv(src);
  for (const m of [1, 100, 400, 1600]) if (!iv.every(([a, b]) => covers(keptOf(strip(src, { fraction: 1, maxChars: m }), src), a, b))) return 'rung ' + m;
  return iv.length === 1;
});

// ============================================================ S9 Min width and gap
// R14: gaps are checked on texts without astral characters or CR (the surrogate and CRLF rules extend the kept side last and may shrink a gap).
const widthProblems = (src, d, { minKeep = 2, minGap = 16, prot = protIv(src) } = {}) => {
  for (const p of d.parts) {
    if (p.kept != null && p.kept.length < minKeep && !overlaps(prot, p.start, p.end)) return `kept run ${J(p.kept)} at ${p.start} is under ${minKeep}`;
    if (p.omit && p.start > 0 && p.end < src.length && p.omit.n < minGap) return `omitted run of ${p.omit.n} at ${p.start} is under ${minGap}`;
  }
  return null;
};
await check('S9 width: defaults over the corpus: no unprotected kept run under 2, no inner omitted run under 16 (5 in chars mode)', () =>
  firstBad(runs(), x => widthProblems(x.src, x.dec, { minGap: x.mode === 'chars' ? 5 : 16 })));
await check('S9 width: the policy keys move the limits (minKeep 5, minGap 40; chars with minGap 9)', () => {
  for (const src of [EMB.stems, EMB.outstore, EMB.log, genProse(12, 40), genJson(5, 30)]) {
    for (const mode of ['auto', 'words', 'lines']) { const w = widthProblems(src, decode(strip(src, { mode, minKeep: 5, minGap: 40 }).text), { minKeep: 5, minGap: 40 }); if (w) return `${mode} ${w}`; }
    const w = widthProblems(src, decode(strip(src, { mode: 'chars', minGap: 9 }).text), { minGap: 9 }); if (w) return 'chars ' + w;
  }
  return true;
});

// ============================================================ S10 No splits
const ASTRAL = ['\u{1D49C}', '\u{1D4B7}', '\u{1D4B8}', '\u{1F600}', '\u{20BB7}'];
const genAstral = seed => { const r = rng(seed), alpha = ['a', 'b', 'ab', '\u{1D49C}', '\u{1D4B7}x', 'x\u{1D49C}y', '\u{20BB7}'], out = []; for (let i = 0; i < 700; i++) { const w = []; for (let j = 0, k = 1 + Math.floor(r() * 3); j < k; j++) w.push(pick(r, alpha)); out.push(w.join('') + (r() < 0.2 ? ' \u{1F600} ' : ' ')); } return out.join('').trim(); };
const splitProblems = (src, d) => {
  const hi = c => c >= 0xD800 && c <= 0xDBFF, lo = c => c >= 0xDC00 && c <= 0xDFFF;
  for (const p of d.parts) for (const q of [p.start, p.end]) {
    if (q <= 0 || q >= src.length) continue;
    if (hi(src.charCodeAt(q - 1)) && lo(src.charCodeAt(q))) return 'surrogate pair split at ' + q;
    if (src[q - 1] === '\r' && src[q] === '\n') return 'CRLF split at ' + q;
  }
  return null;
};
const noSplitInputs = lazy(() => [
  ['astral-words', genAstral(1)], ['astral-words-2', genAstral(2)], ['astral-only', '\u{1D49C}\u{1D4B7}'.repeat(300)],
  ['astral-prose', genProse(13, 25).replace(/ (the|of|and) /g, ' $1\u{1F600} ')],
  ['crlf-prose', genProse(14, 25).replace(/\n/g, '\r\n')], ['crlf-wrapped', wrap(genProse(15, 25).replace(/\n\n/g, ' '), 40).replace(/\n/g, '\r\n')],
  ['crlf-log', genLog(2, 50).replace(/\n/g, '\r\n')], ['crlf-astral', genAstral(3).replace(/ /g, (m, i) => i % 9 === 0 ? '\r\n' : m)],
]);
await check('S10 splits: no kept span or marker boundary between the halves of a pair or between CR and LF (astral and CRLF fixtures, all modes and budgets)', () => {
  const inputs = noSplitInputs(); // the fixtures hold what the check is about: pairs, and CRLF
  if (!inputs.some(([, s]) => /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(s)) || !inputs.some(([, s]) => s.includes('\r\n')) || !ASTRAL.every(c => c.length === 2)) return 'fixtures';
  for (const [name, src] of inputs) for (const mode of MODES) for (const p of [{ fraction: 0.1 }, { fraction: 0.2 }, { fraction: 0.3 }, { fraction: 0.5 }, { maxChars: 120 }, { maxChars: 1 }]) {
    let d; try { d = decode(strip(src, { mode, ...p }).text); } catch (e) { return `${name} ${mode} ${J(p)}: ${e.message}`; }
    const w = splitProblems(src, d) || reproduces(src, d); if (w) return `${name} ${mode} ${J(p)}: ${w}`;
  }
  return true;
});

// ============================================================ S11 Must-keep
const protText = lazy(() => genProse(40, 60).split('\n\n').map((p, i) => i === 3 ? p + ' see os:abc123def456 for details' : i === 7 ? 'os:q1w2e3r4t5y6 ' + p : i === 11 ? p.slice(0, 120) + ' ORDER-4711 ' + p.slice(120) : p).join('\n\n'));
await check('S11 keep: every protect match survives whole at any budget and mode (default pattern and a custom one)', () => {
  const src = protText(), pats = ['os:[a-z0-9]{6,12}', 'ORDER-\\d{4}'], iv = protIv(src, pats);
  if (iv.length !== 3) return 'fixture has ' + iv.length + ' matches';
  for (const mode of MODES) for (const p of [{ fraction: 0.1 }, { fraction: 0.3 }, { fraction: 0.7 }, { maxChars: 200 }, { maxChars: 1 }]) {
    const r = strip(src, { mode, protect: pats, ...p }), kept = keptOf(r, src);
    if (!iv.every(([a, b]) => covers(kept, a, b))) return `${mode} ${J(p)}`;
  }
  return true;
});
await check('S11 keep: a handle in the text is protected with no protect key given, and an empty protect list protects nothing', () => {
  const src = protText(), iv = protIv(src, ['os:[a-z0-9]{6,12}']);
  const withDefault = keptOf(strip(src, { maxChars: 1 }), src), none = strip(src, { maxChars: 1, protect: [] }).text;
  return iv.length === 2 && iv.every(([a, b]) => covers(withDefault, a, b)) && decode(none).parts.length === 1;
});
await check('S11 keep: with keepFirst 1 the body starts with the first line, to lineCap (default 80 and 30), when the budget is above the floor', () => {
  for (const { name, text } of corpus().filter(c => c.text.length >= 1500)) for (const cap of [undefined, 30]) {
    const first = text.split('\n')[0], want = first.slice(0, cap ?? 80);
    if (!want) continue;
    const d = decode(strip(text, { fraction: 0.3, keepFirst: 1, ...(cap ? { lineCap: cap } : {}) }).text), p0 = d.parts[0];
    if (!(p0.kept != null && p0.start === 0 && p0.kept.startsWith(want))) return `${name} cap ${cap}: ${J(p0.kept ?? p0.omit)}`;
  }
  return true;
});
await check('S11 keep: keepFirst 2 keeps two short first lines whole; keepFirst 0 and the floor budget do not require them', () => {
  const src = 'First short line here\nSecond short line there\n' + genProse(16, 30), d = decode(strip(src, { fraction: 0.3, keepFirst: 2 }).text);
  const d1 = decode(strip(src, { maxChars: 1 }).text);
  return d.parts[0].kept != null && d.parts[0].kept.startsWith('First short line here\nSecond short line there') && d1.parts.length === 1;
});
await check('S11 keep: keepLast k keeps the last k lines (k 1, 2, 3) at fraction 0.3', () => {
  const src = wrap(genProse(17, 40).replace(/\n\n/g, ' '), 60), lines = src.split('\n');
  for (const k of [1, 2, 3]) {
    const d = decode(strip(src, { fraction: 0.3, keepLast: k }).text), last = d.parts.at(-1);
    if (!(last.kept != null && last.end === src.length && last.kept.endsWith(lines.slice(-k).join('\n')))) return 'k ' + k;
  }
  return true;
});

// ============================================================ S12 Retention preference
// The baseline is outstore.present's head and tail ('ends'). present stores the blob through IndexedDB, so a labelled stand-in is installed
// here (the suite is plain node): put and get on a Map, callbacks after a tick. The baseline output is not edited, only produced.
const installIdb = () => {
  if (globalThis.indexedDB) return;
  const data = new Map(), later = fn => { const r = {}; setTimeout(() => { r.result = fn(); r.onsuccess && r.onsuccess(); }, 0); return r; };
  const store = { put: (v, k) => later(() => { data.set(k, v); return k; }), get: k => later(() => data.get(k)) };
  globalThis.indexedDB = { open: () => { const r = { result: { createObjectStore() {}, transaction: () => ({ objectStore: () => store }) } }; setTimeout(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); }, 0); return r; } };
};
const wholeUnits = (text, set) => { const hit = new Set(); for (const m of text.matchAll(UNIT)) if (set.has(m[0])) hit.add(m[0]); return hit.size; };
const keptText = d => d.parts.filter(p => p.kept != null).map(p => p.kept).join('\n'); // units never join across kept spans
await check('S12 retention: on seeded blobs the share of hapax identifiers and numbers kept beats head-and-tail at equal output chars (2x together, 1.5x each)', async () => {
  installIdb();
  for (const mode of ['auto', 'words']) for (let seed = 1; seed <= 5; seed++) {
    const b = genBlob(seed, 300), text = O.squeeze(b.text);
    if (text !== b.text) return 'fixture is not squeezed';
    const base = await O.present(text), chars = base.length;
    if (!/ ends\]\n/.test(base.split('\n')[0] + '\n')) return 'baseline is not the ends view: ' + base.slice(0, 60);
    const r = strip(text, { mode, maxChars: chars }), d = decode(r.text);
    if (r.text.length > chars) return `seed ${seed}: stripe ${r.text.length} chars over baseline ${chars}`;
    const ids = new Set(b.ids), nums = new Set(b.nums), all = new Set([...b.ids, ...b.nums]), kt = keptText(d), bt = base.split('\n').slice(1).join('\n');
    const sI = wholeUnits(kt, ids) / ids.size, sN = wholeUnits(kt, nums) / nums.size, sA = wholeUnits(kt, all) / all.size;
    const bI = wholeUnits(bt, ids) / ids.size, bN = wholeUnits(bt, nums) / nums.size, bA = wholeUnits(bt, all) / all.size;
    const beats = (s, b0, f) => s > 0 && s >= f * b0;
    if (!beats(sA, bA, 2) || !beats(sI, bI, 1.5) || !beats(sN, bN, 1.5)) return `${mode} seed ${seed}: stripe ids ${sI.toFixed(2)} nums ${sN.toFixed(2)} all ${sA.toFixed(2)} vs baseline ${bI.toFixed(2)} ${bN.toFixed(2)} ${bA.toFixed(2)}`;
  }
  return true;
});

// ============================================================ S13 Mode shapes
// R9: the shape checks switch off the sources of partial units (keepFirst 0, class prose, no 40-char units with a digit in the inputs).
const SHAPE = { keepFirst: 0, class: 'prose' };
const shapeCorpus = lazy(() => corpus().filter(c => !(c.text.match(UNIT) || []).some(u => u.length >= 40 && /\d/.test(u)) && !protIv(c.text).length));
await check('S13 modes: lines mode puts every marker boundary at a line boundary', () => {
  for (const { name, text } of shapeCorpus()) for (const b of BUDGETS) {
    const d = decode(strip(text, { ...SHAPE, mode: 'lines', fraction: b }).text);
    for (const p of omits(d)) for (const q of [p.start, p.end]) if (!(q === 0 || q === text.length || text[q - 1] === '\n' || text[q] === '\n')) return `${name} ${b}: boundary ${q} is inside a line`;
  }
  return true;
});
await check('S13 modes: words mode keeps no partial unit: every kept run starts and ends at a unit edge', () => {
  for (const { name, text } of shapeCorpus()) for (const b of BUDGETS) {
    const d = decode(strip(text, { ...SHAPE, mode: 'words', fraction: b }).text), units = unitIv(text);
    for (const p of d.parts) if (p.kept != null) for (const q of [p.start, p.end]) if (units.some(([a, e]) => a < q && q < e)) return `${name} ${b}: boundary ${q} inside a unit`;
  }
  return true;
});
await check('S13 modes: chars mode cuts units on the gram grid (2 wide, the last 3 when the unit is odd)', () => {
  for (const { name, text } of shapeCorpus()) for (const b of BUDGETS) {
    const d = decode(strip(text, { ...SHAPE, mode: 'chars', fraction: b }).text), units = unitIv(text);
    for (const p of d.parts) if (p.kept != null) for (const q of [p.start, p.end]) for (const [a, e] of units) if (a < q && q < e && !((q - a) % 2 === 0 && e - q >= 2)) return `${name} ${b}: boundary ${q} in unit ${a}-${e} is off the grid`;
  }
  return true;
});
await check('S13 modes: auto is the default (equal to mode auto and to the DEFAULTS policy) and the four modes do not all give the same text', () => {
  const t = EMB.stems, a = strip(t), outs = MODES.map(mode => strip(t, { mode }).text);
  return same(a, strip(t, { mode: 'auto' })) && same(a, strip(t, S.DEFAULTS)) && S.DEFAULTS.mode === 'auto' && new Set(outs).size >= 3;
});

// ---- next group ----
if (S.missing) console.log('app/stripe.js: ' + S.missing);
console.log('\n' + Object.entries(counts).map(([g, n]) => `${g}:${n}`).join(' '));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
