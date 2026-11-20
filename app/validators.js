// Step validators (docs/concepts/FLOWS.md F1; seam: validate). The list bullets of a skill or agent md file
// become step validator records by code, with no model, and those resolve against recorded sessions into
// validation result records. Pure functions, no Node or DOM API (scripts/validators.mjs is the node entry).
//
// - A record cites its source: path, line range and a hash of those lines. When the cited lines no longer
//   hash the same, the validator is unresolved, never passed (invariant 6).
// - Records are harness data beside the turns: a session record is read and never written, and a result
//   holds a pointer to the tool call that showed the evidence (session#m<message>.c<call>), never its text.
// - Never blocking: a fail is a returned record. Nothing here throws on one or stops anything (QF5).
// - Evidence is what a session did (its tool calls and their arguments, its ledger cost), not what was said.
//
// Seams: register(check, fn) adds a check kind; reader(fn) adds a record shape.
import { contentHash } from './handles.js';

const lf = t => String(t ?? '').replace(/\r\n/g, '\n');
const BULLET = /^(\s*)(\d+\.|[-*])\s+(\S.*)$/;
// the hash of the cited lines of a source text (1-based, inclusive)
export const hashLines = (text, [a, b]) => contentHash(lf(text).split('\n').slice(a - 1, b).join('\n'));

// ---- bullets: every list item outside the front matter and code fences, with its lines and section
export function bullets(text) {
  const lines = lf(text).split('\n'), out = [];
  let i = 0, section = '', fence = false, cur = null;
  if (lines[0]?.trim() === '---') { i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++; }
  const close = () => { if (cur) { out.push(cur); cur = null; } };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { fence = !fence; close(); continue; }
    if (fence) continue;
    const h = l.match(/^#{1,6}\s+(.*)$/), b = l.match(BULLET);
    if (h) { close(); section = h[1].trim(); }
    else if (b) { close(); cur = { line_start: i + 1, line_end: i + 1, indent: b[1].length, ordinal: /\d/.test(b[2]) ? parseInt(b[2], 10) : null, section, text: b[3].trim() }; }
    else if (cur && l.trim() && l.match(/^\s*/)[0].length > cur.indent) { cur.line_end = i + 1; cur.text += ' ' + l.trim(); }
    else close();
  }
  close();
  return out;
}

// ---- what a bullet names: code spans, classed by their form only
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACE = /<[^<>]+>/;
const bare = s => s.replace(/<[^<>]+>/g, '').replace(/\*/g, '');
// a pattern from a literal: <placeholder> is any text, * is any run inside one path segment
const pattern = (s, anchored) => (anchored ? '^' : '') + s.split(/(<[^<>]+>|\*)/).map(p => PLACE.test(p) ? '.+?' : p === '*' ? '[^/\\s]*' : esc(p)).join('');
function classify(span) {
  const s = span.trim(), quoted = s.match(/"([^"]*<[^<>]+>[^"]*)"/), has = PLACE.test(s);
  const ev = (kind, text, anchored = false) => ({ kind, text, pattern: pattern(text, anchored) });
  if (quoted && bare(quoted[1]).trim().length >= 3) return ev('template', quoted[1], true);     // "Spec: <behaviour> (<why>)" inside a command
  if (/^[A-Za-z][\w-]*:$/.test(s)) return ev('template', s, true);                                // a label prefix: Spec:
  if (/\s/.test(s)) {
    if (has && /^[A-Za-z][\w-]*: /.test(s)) return ev('template', s, true);                       // Spec: <what and why>
    const tokens = s.split(/\s+/);
    return /^[a-z][\w.-]*$/.test(tokens[0]) && tokens.length > 1 ? ev('command', s) : null;      // node scripts/ci.mjs main git
  }
  if (s.includes('/') || /\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(s)) return ev(has ? 'template' : 'path', s);
  return has && bare(s).length >= 3 ? ev('template', s) : null;                                   // a bare name is nothing to look for
}
const NEG = /\b(never|not|no|without|don't)\b/i, ORDER = /\b(then|before)\b/i, MONEY = /\$(\d+(?:\.\d+)?)/;
const RANK = { template: 3, command: 2, path: 1 };

// one bullet -> {check, shape} or {check: null, shape: null} when there is nothing to look for
function shapeOf(text) {
  const spans = [...text.matchAll(/`([^`]+)`/g)].map(m => ({ at: m.index, end: m.index + m[0].length, ev: classify(m[1]) })).filter(x => x.ev);
  const prose = text.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
  // forbidden: a negation between the last clause break and the span
  for (const x of spans) x.neg = NEG.test(prose.slice(Math.max(...['.', ';', ',', ':', '('].map(c => prose.lastIndexOf(c, x.at))) + 1, x.at));
  const need = spans.filter(x => !x.neg), forbidden = spans.filter(x => x.neg).map(x => x.ev);
  const money = prose.match(MONEY);
  if (money) return { check: 'cost', shape: { step: text, expected: [{ kind: 'cost', text: money[0], limit: Number(money[1]) }], forbidden: [], result: 'the ledger cost of the session is at or under the limit' } };
  if (!spans.length) return { check: null, shape: null };
  // order: two of the same kind with "then" or "before" between them
  for (let i = 0; i + 1 < need.length; i++) {
    const a = need[i], b = need[i + 1];
    if (a.ev.kind === b.ev.kind && ORDER.test(prose.slice(a.end, b.at))) return { check: 'order', shape: { step: text, expected: [a.ev, b.ev], forbidden, result: 'the first is found, and the second after it' } };
  }
  // otherwise the most specific kind named is what is expected; any one of them is enough
  const top = Math.max(0, ...need.map(x => RANK[x.ev.kind])), expected = need.filter(x => RANK[x.ev.kind] === top).map(x => x.ev);
  const formed = expected.some(e => e.kind === 'template');
  return { check: formed ? 'shape' : 'presence', shape: { step: text, expected, forbidden, result: (expected.length ? 'one of the expected is found' : 'nothing is expected') + (forbidden.length ? ', and nothing forbidden is found' : '') } };
}

// ---- extract: text of an md file -> step validator records
// purpose is one of FLOWS.md QF5 (inject basis | drive policy | passive structure); code cannot tell, so it is the caller's.
export function extract(text, source_path, { purpose = 'passive structure' } = {}) {
  const p = String(source_path).replace(/\\/g, '/'), name = lf(text).match(/^name:\s*(.+)$/m)?.[1].trim() || p, seen = {};
  const kind = /(^|\/)agents\//.test(p) ? 'agent' : /(^|\/)skills\//.test(p) ? 'skill' : 'file';
  return bullets(text).map(b => {
    const range = [b.line_start, b.line_end], h = hashLines(text, range), n = seen[h] = (seen[h] || 0) + 1;
    return { id: 'sv-' + contentHash(p + '\n' + h) + (n > 1 ? '-' + n : ''), source_path: p, source_line_range: range, step_text_hash: h, ...shapeOf(b.text), purpose, applies_to: { kind, name, section: b.section, step: b.ordinal } };
  });
}

// ---- command lines: a `git commit` message inside a command line is evidence of its own
// A shell tool call holds a whole line (`git add x && git commit -m 'Spec: ...' && git log -1`), so a template
// anchored at the start of an argument never sees the message. commitMessages reads the line the way a shell
// splits it (quotes, backslashes, `&&` `||` `;` `|` `&` newline and parentheses between commands) and returns the
// message arguments of each `git commit`. By code only: nothing is evaluated ($( and backticks stay as written),
// and a word cut off inside its quote (a profile keeps the first line of a command) is no message.
const GIT = /(^|[\\/])git(\.exe)?$/, WRAP = /^([A-Za-z_]\w*=.*|sudo|command|env|time|exec|nohup|nice|builtin)$/;
const GIT_VAL = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);
const COMMIT_VAL = new Set(['-F', '-C', '-c', '-t', '--file', '--author', '--date', '--template', '--reuse-message', '--reedit-message']);
// a command line -> segments (one per command) of words {w, open}; open: the word ends inside an unclosed quote
function segments(line) {
  const s = String(line), segs = []; let seg = [], w = null, i = 0;
  const word = open => { if (w !== null) seg.push({ w, open }); w = null; };
  const cut = () => { word(false); if (seg.length) segs.push(seg); seg = []; };
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1); w = (w ?? '') + s.slice(i + 1, j < 0 ? s.length : j);
      if (j < 0) { word(true); break; }
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1, t = '';
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && j + 1 < s.length) { const n = s[j + 1]; if ('$`"\\'.includes(n)) { t += n; j++; } else if (n === '\n') j++; else t += '\\'; }
        else t += s[j];
      }
      w = (w ?? '') + t;
      if (j >= s.length) { word(true); break; }
      i = j + 1;
    } else if (c === '\\') {
      if (s[i + 1] !== undefined && s[i + 1] !== '\n') w = (w ?? '') + s[i + 1];
      i += 2;
    } else if (c === ' ' || c === '\t' || c === '\r') { word(false); i++; }
    else if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')') { cut(); i++; }
    else if (c === '#' && w === null) { while (i < s.length && s[i] !== '\n') i++; }
    else { w = (w ?? '') + c; i++; }
  }
  cut();
  return segs;
}
export function commitMessages(line) {
  if (typeof line !== 'string' || !line.includes('commit')) return [];
  const out = [];
  for (const seg of segments(line)) {
    let i = 0;
    while (i < seg.length && WRAP.test(seg[i].w)) i++;
    if (!(i < seg.length && GIT.test(seg[i].w))) continue;
    for (i++; i < seg.length && seg[i].w.startsWith('-'); i += GIT_VAL.has(seg[i].w) ? 2 : 1);
    if (seg[i]?.w !== 'commit') continue;
    // git joins the -m arguments of one commit into one message, paragraphs separated by a blank line
    let msgs = [];
    for (let j = i + 1; j < seg.length; j++) {
      const x = seg[j], m = x.w.match(/^--message=([\s\S]*)$/) || x.w.match(/^-[aesnqvipo]*m([\s\S]+)$/);
      if (x.w === '--') break;
      if (x.w === '--message' || /^-[aesnqvipo]*m$/.test(x.w)) { const v = seg[++j]; if (v && !v.open) msgs.push(v.w); }
      else if (m) { if (!x.open) msgs.push(m[1]); }
      else if (COMMIT_VAL.has(x.w)) j++;
    }
    if (msgs.length) out.push(msgs.join('\n\n'));
  }
  return out;
}

// ---- evidence readers: a record -> {session, kind, calls: [{turn, msg, call, name, args: [strings] | null, cmds?: [strings]}], cost: number | null}
// cmds are the arguments that are command lines (a call that does not give them: all the arguments of a shell tool).
// Every reader gets this through the call, so a command line is read in one place, whatever the record kind.
const keyed = (v, k = '') => typeof v === 'string' ? [[k, v]] : v && typeof v === 'object' ? Object.entries(v).flatMap(([n, x]) => keyed(x, Array.isArray(v) ? k : n)) : v == null ? [] : [[k, String(v)]];
const CMDKEY = /^(cmd|command|cmdline|commandline|script|shell|bash)$/i, SHELLISH = /^(shell|bash|sh|zsh|exec|terminal|powershell|pwsh|run_shell|run_command|execute_command|shell_exec)$/i;
const cmdsOf = (name, pairs) => pairs.filter(([k]) => CMDKEY.test(k) || SHELLISH.test(String(name ?? ''))).map(([, s]) => s);
const parsed = a => { try { return keyed(JSON.parse(a)); } catch { return [['', String(a ?? '')]]; } };
const args = a => parsed(a).map(([, s]) => s);
const lines = c => c.cmds ?? (SHELLISH.test(String(c.name ?? '')) ? c.args || [] : []);
const readers = [
  // a stored session (wh:s:<id>, a .session export, a .trace read by fromTrace): messages with tool calls, ledger rows
  r => {
    if (!Array.isArray(r?.messages)) return null;
    const calls = []; let turn = -1;
    r.messages.forEach((m, i) => { if (m.role === 'user') turn++; (m.tool_calls || []).forEach((t, j) => calls.push({ turn: Math.max(turn, 0), msg: i, call: j, name: t.function?.name, args: args(t.function?.arguments), cmds: cmdsOf(t.function?.name, parsed(t.function?.arguments)) })); });
    const led = Array.isArray(r.ledger) ? r.ledger : [];
    return { session: r.id, kind: 'session', calls, cost: led.length ? led.reduce((n, e) => n + (Number(e.cost) || 0), 0) : null };
  },
  // a turn profile (app/profile.js): tool names per turn and costs; when it has per-call argument summaries,
  // the kept fields (paths, commands, handles) become evidence, while summarised content is not a string to match
  r => {
    if (!Array.isArray(r?.perTurn)) return null;
    const kept = (v, k = '') => typeof v === 'string' ? [[k, v]] : v && typeof v === 'object'
      ? (typeof v.hash === 'string' && typeof v.length === 'number' ? [] : Object.entries(v).flatMap(([n, x]) => kept(x, Array.isArray(v) ? k : n))) : v == null ? [] : [[k, String(v)]];
    const calls = r.perTurn.flatMap(t => Array.isArray(t.args)
      ? t.args.map((c, j) => ({ turn: t.n, msg: null, call: j, name: c.name, args: kept(c.args).map(([, s]) => s), cmds: cmdsOf(c.name, kept(c.args)) }))
      : String(t.tools || '').split(' ').filter(Boolean).map((name, j) => ({ turn: t.n, msg: null, call: j, name: name.split(':')[0], args: null })));
    return { session: r.id, kind: 'profile', calls, cost: r.cost?.total ?? null };
  },
];
export const reader = fn => { readers.unshift(fn); };
export function read(record) { for (const fn of readers) { const ev = fn(record); if (ev) return ev; } return null; }

// a .trace export -> session records: each conversation is the longest message list sent for its first user message
export function fromTrace(trace, name = 'trace') {
  const by = new Map();
  for (const e of trace?.exchanges || []) {
    let b = e.request?.messages ? e.request : e.request?.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
    if (!Array.isArray(b?.messages) || !Array.isArray(b.tools)) continue; // main requests carry the tool list; helper requests do not
    const k = contentHash(JSON.stringify(b.messages.find(m => m.role === 'user')?.content ?? '')), cur = by.get(k);
    if (!cur || b.messages.length > cur.messages.length) by.set(k, { id: `${name}:${k}`, title: name, from: 'trace', t: cur?.t || e.t, messages: b.messages, ledger: [] });
  }
  return [...by.values()];
}

// ---- checks: (validator, evidence) -> {outcome, reason, at: a call or null}
// seek: the first call from `from` on that shows the expected evidence -> {i, cmd} or null. A call shows it in one of its
// arguments; and, for a pattern anchored at the start (^), in a git commit message inside one of its command lines
// (cmd: true), because a whole command line never starts with the message. Unanchored patterns see arguments only.
const msgs = new WeakMap();
const messagesOf = c => { let m = msgs.get(c); if (!m) msgs.set(c, m = lines(c).flatMap(commitMessages)); return m; };
function seek(ev, exp, from = 0) {
  const re = new RegExp(exp.pattern), anchored = exp.pattern.startsWith('^');
  for (let i = from; i < ev.calls.length; i++) {
    const c = ev.calls[i];
    if (!c.args) continue;
    if (c.args.some(a => re.test(a))) return { i, cmd: false };
    if (anchored && messagesOf(c).some(m => re.test(m))) return { i, cmd: true };
  }
  return null;
}
const hit = (ev, exp) => seek(ev, exp)?.i ?? -1;
const shown = (ev, s) => ({ outcome: 'pass', at: ev.calls[s.i], ...(s.cmd ? { in_command: true } : {}) });
const blind = ev => ev.calls.some(c => !c.args); // the record has calls whose arguments it does not hold
const found = (v, ev) => {
  for (const f of v.shape.forbidden || []) { const i = hit(ev, f); if (i >= 0) return { outcome: 'fail', reason: 'forbidden', at: ev.calls[i] }; }
  for (const x of v.shape.expected) { const s = seek(ev, x); if (s) return shown(ev, s); }
  if (blind(ev)) return { outcome: 'unresolved', reason: 'no-arguments' };
  return v.shape.expected.length ? { outcome: 'fail', reason: 'absent' } : { outcome: 'pass' };
};
const checks = new Map(Object.entries({
  presence: found,
  shape: found,
  order(v, ev) {
    for (const f of v.shape.forbidden || []) { const i = hit(ev, f); if (i >= 0) return { outcome: 'fail', reason: 'forbidden', at: ev.calls[i] }; }
    if (blind(ev)) return { outcome: 'unresolved', reason: 'no-arguments' };
    const [a, b] = v.shape.expected, i = hit(ev, a);
    if (i < 0) return { outcome: 'fail', reason: 'absent' };
    const s = seek(ev, b, i + 1);
    return s ? shown(ev, s) : hit(ev, b) >= 0 ? { outcome: 'fail', reason: 'order', at: ev.calls[hit(ev, b)] } : { outcome: 'fail', reason: 'absent' };
  },
  cost(v, ev) {
    if (ev.cost == null) return { outcome: 'unresolved', reason: 'no-ledger' };
    return ev.cost <= v.shape.expected[0].limit ? { outcome: 'pass' } : { outcome: 'fail', reason: 'over' };
  },
}));
export function register(check, fn) {
  if (checks.has(check)) throw new Error(check + ' is taken: a changed check gets a new name');
  checks.set(check, fn);
}
export const kinds = () => [...checks.keys()];

// ---- resolve: one validator against one record -> a validation result record
// sources: {source_path: current text}. flow_id: the flow the session was attributed to, when there is one.
export function resolve(v, record, { sources = {}, flow_id = null } = {}) {
  const ev = read(record), session = ev?.session ?? record?.id ?? null;
  const src = sources[v.source_path];
  let r;
  if (!v.check) r = { outcome: 'unresolved', reason: 'no-shape' };
  else if (src == null) r = { outcome: 'unresolved', reason: 'source-unread' };
  else if (hashLines(src, v.source_line_range) !== v.step_text_hash) r = { outcome: 'unresolved', reason: 'stale-source' };
  else if (!ev) r = { outcome: 'unresolved', reason: 'unread-record' };
  else if (!checks.has(v.check)) r = { outcome: 'unresolved', reason: 'no-check' };
  else { try { r = checks.get(v.check)(v, ev) || {}; } catch { r = { outcome: 'unresolved', reason: 'check-error' }; } }
  const outcome = ['pass', 'fail'].includes(r.outcome) ? r.outcome : 'unresolved', at = r.at || null;
  return {
    id: 'vr-' + contentHash([v.id, v.step_text_hash, session, ev?.kind].join('\n')), validator_id: v.id, flow_id, session,
    at_turn: at ? at.turn : null, outcome, reason: r.reason || null, carried_to: [],
    ...(r.in_command ? { in_command: true } : {}), // the evidence was a message inside a command line of the call
    evidence_handle: at ? `${session}#${at.msg == null ? 't' + at.turn : 'm' + at.msg}.c${at.call}` : null,
    tokens: 0, cost: 0, // resolved by code: no request was made
  };
}
export const resolveAll = (validators, record, opts) => validators.map(v => resolve(v, record, opts));

// counts for a report: by outcome, and unresolved or failed by reason
export function tally(results) {
  const t = { pass: 0, fail: 0, unresolved: 0, reasons: {} };
  for (const r of results) { t[r.outcome]++; if (r.reason) t.reasons[r.reason] = (t.reasons[r.reason] || 0) + 1; }
  return t;
}
