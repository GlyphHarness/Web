// Terminal input and output, outside the machine: what the person typed (history),
// stdio hooks (filters on the way in and out), and the scratch helper's protocol.
//
// Hooks: named, ordered text filters. "up" runs on what the person sends to a
// terminal, "down" on what comes back (the terminal view and the shell tool's
// result for the model). Built-ins below; register() adds more (a sanitizer, a
// recorder, a policy), switched on per name in settings.termHooks {up: [], down: []}.

export const HOOKS = {
  up: {
    smartquotes: { label: 'smart punctuation to ASCII (“ ” ‘ ’ — …)', fn: t => t.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'").replace(/—/g, '--').replace(/–/g, '-').replace(/…/g, '...').replace(/ /g, ' ') },
    // phone keyboards capitalise the first word: "Ls -la", "Git status"
    autocap: { label: 'undo a capitalised first word (phone keyboards)', fn: t => t.replace(/^(\s*)([A-Z])([a-z0-9._-]*)(?=\s|$)/, (m, sp, a, rest) => sp + a.toLowerCase() + rest) },
    trimend: { label: 'drop trailing spaces', fn: t => t.replace(/[ \t]+$/g, '') },
  },
  down: {
    // ctx.secrets: values never to show (API keys, the GitHub credential, minted tokens)
    mask: { label: 'mask known secrets', fn: (t, ctx) => (ctx?.secrets || []).filter(v => typeof v === 'string' && v.length > 8).reduce((x, k) => x.split(k).join('[key]'), t) },
  },
};
export const DEFAULT_ON = { up: ['smartquotes', 'autocap', 'trimend'], down: ['mask'] };

export function register(dir, name, label, fn) {
  if (!HOOKS[dir]) throw new Error('hook direction is up or down');
  HOOKS[dir][name] = { label, fn };
}
// run the switched-on hooks in their listed order; returns the text and which changed it
export function apply(dir, text, ctx = {}, on = DEFAULT_ON[dir]) {
  let out = String(text ?? '');
  const changed = [];
  for (const name of on || []) {
    const h = HOOKS[dir]?.[name];
    if (!h) continue;
    const next = String(h.fn(out, ctx) ?? out);
    if (next !== out) changed.push(name);
    out = next;
  }
  return { text: out, changed };
}

// ---------- history: commands the person typed, per target ----------
// {cmd, target, t, n, pinned}; most recent first, pinned kept, at most 200.
const KEY = 'wh:termhist';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
export const history = () => load();
export function remember(cmd, target) {
  const c = String(cmd || '').trim();
  if (!c) return load();
  const list = load(), i = list.findIndex(e => e.cmd === c);
  const old = i >= 0 ? list.splice(i, 1)[0] : null;
  list.unshift({ cmd: c, target, t: Date.now(), n: (old?.n || 0) + 1, pinned: old?.pinned || false });
  const keep = list.filter((e, k) => e.pinned || k < 200);
  save(keep);
  return keep;
}
export function pin(cmd, on) { const list = load(); for (const e of list) if (e.cmd === cmd) e.pinned = on; save(list); return list; }
export function forget(cmd) { const list = load().filter(e => e.cmd !== cmd); save(list); return list; }
// the last command the person typed (for a target, or any), not the last one that ran
export const lastTyped = target => load().find(e => !target || e.target === target) || null;

// ---------- scratch helper ----------
// A small model drafts commands; it may test them first in a scratch account
// (TRY lines, run by the harness, answered with TRIED/EXIT/OUTPUT), then gives
// the final commands in one sh block. Text protocol: works with models without tool calls.
export const SCRATCH_SYSTEM = `TERMINAL SCRATCH. You draft shell commands for a person to run in a terminal on an Alpine Linux machine (bash, coreutils, git, python3, gh, curl, jq; more packages with: wh-install <name>).
You may test first in a scratch account: reply with up to 3 lines "TRY: <command>". Tests must be safe: read-only, or writing only inside the scratch home; no pushes, no deletes outside it. They are run for you, and the reply holds TRIED, EXIT and OUTPUT.
When ready, reply with only one \`\`\`sh block: one command per line, each optionally followed by a line "# <why>". No other prose.`;

export function parseScratch(text) {
  const t = String(text || '');
  const tries = [...t.matchAll(/^TRY:\s*(.+)$/gm)].map(m => m[1].trim()).filter(Boolean).slice(0, 3);
  const block = /```(?:sh|bash|shell)?\n([\s\S]*?)```/.exec(t);
  const commands = [];
  if (block) for (const line of block[1].split('\n')) {
    const l = line.trimEnd();
    if (!l.trim()) continue;
    if (/^\s*#\s?/.test(l)) { if (commands.length) commands.at(-1).note = (commands.at(-1).note ? commands.at(-1).note + ' ' : '') + l.replace(/^\s*#\s?/, ''); continue; }
    commands.push({ cmd: l });
  }
  return { tries: block ? [] : tries, commands };
}
