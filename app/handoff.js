// Handoff blocks: content in a reply that the person takes away rather than reads
// (something to copy, a file to save, a command to run, a view, a config to apply).
// In a reply it is a fence whose info string starts with handoff:
//   ```handoff:copy <title>          ```handoff:file <name>     ```handoff:command <title>
//   ```handoff:view <html|json|csv> <title>                     ```handoff:config <title>
// Plain fences stay code. When the person's message asked to show, copy, save or run
// something and a reply used plain fences anyway, those are shown as copy handoffs
// (promote): display only, the reply's text is not changed.

export const KINDS = ['copy', 'file', 'command', 'view', 'config'];

// "handoff:file notes.md" -> {kind, arg, title}; null when it is not a handoff fence
export function parse(info) {
  const m = /^handoff:(\w+)\s*(.*)$/i.exec(String(info || '').trim());
  if (!m) return null;
  const kind = KINDS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : 'copy';
  let rest = m[2].trim(), arg = '';
  if (kind === 'file' || kind === 'view') { const sp = rest.split(/\s+/); arg = sp.shift() || ''; rest = sp.join(' '); }
  return { kind, arg, title: rest || (kind === 'file' ? arg : '') };
}

// does the person's message ask for something to take away?
export const wants = text => /\b(copy|copyable|paste|display|show me|give me|print|download|save (it|this|that)? ?(as|to)? ?(a )?file|as a file|command|snippet|config block)\b/i.test(String(text || ''));

export { HANDOFF_LINE as LINE } from './context.js';

export function csvRows(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/).filter(l => l.trim())) {
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur); rows.push(cells);
  }
  return { columns: rows[0] || [], rows: rows.slice(1) };
}
