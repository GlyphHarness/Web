// File explorer for the machine, per session: the session's pinned directories as
// a tree, each entry marked new / modified / existing relative to when the session
// first used the machine, and files opened on demand (nothing is pulled in bulk).
// Plain shell commands on the machine; no model is involved.
//
// The mark: when a session first runs shell, the harness touches
// /tmp/.wh/mark-<session> and records a baseline listing of the pinned directories.
// new = newer than the mark and not in the baseline; modified = in the baseline
// with another size or time; existing = neither. Deleted = in the baseline, gone now.

export const MARK_DIR = '/tmp/.wh';
const q = p => "'" + String(p).replace(/'/g, "'\\''") + "'";
export const markPath = sid => `${MARK_DIR}/mark-${sid.replace(/[^\w-]/g, '')}`;
// BusyBox find has no -printf: stat prints type, size, mtime (seconds) and path, tab-separated
const LIST = "-exec stat -c $'%F\\t%s\\t%Y\\t%n' {} +";

export function parse(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    const [y, size, t, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path || !y || !/^\d+$/.test(size || '')) continue;
    rows.push({ type: /directory/.test(y) ? 'dir' : /link/.test(y) ? 'link' : 'file', size: Number(size), mtime: Number(t), path });
  }
  return rows;
}

// commands
export const markCmd = (sid, pins) => `mkdir -p ${MARK_DIR} && touch ${markPath(sid)} && stat -c %Y ${markPath(sid)} && find ${pins.map(q).join(' ')} -xdev -maxdepth 6 ${LIST} 2>/dev/null | head -20000`;
export const listCmd = dir => `find ${q(dir)} -mindepth 1 -maxdepth 1 ${LIST} 2>/dev/null | sort -t "$(printf '\\t')" -k4 | head -1000`;
export const changedCmd = (sid, pins) => `find ${pins.map(q).join(' ')} -xdev -newer ${markPath(sid)} ${LIST} 2>/dev/null | head -5000`;
export const allCmd = pins => `find ${pins.map(q).join(' ')} -xdev -maxdepth 6 ${LIST} 2>/dev/null | head -20000`;
export const MAX_OPEN = 512 * 1024;
export const readCmd = path => `s=$(stat -c %s ${q(path)} 2>/dev/null || echo -1); echo "size=$s"; head -c ${MAX_OPEN} ${q(path)} 2>/dev/null | base64 | tr -d '\\n'; echo`;

// status of one entry
export function status(row, mark, base) {
  if (!mark) return 'existing';
  const b = base?.get(row.path);
  if (!b) return row.mtime > mark ? 'new' : 'existing';
  if (row.type !== 'dir' && (b.size !== row.size || Math.floor(b.mtime) !== Math.floor(row.mtime))) return 'modified';
  return 'existing';
}

export function decode(out) {
  const m = /size=(-?\d+)\n([A-Za-z0-9+/=]*)/.exec(String(out));
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2] || ''), c => c.charCodeAt(0));
  const binary = bytes.subarray(0, 4096).some(b => b === 0);
  return { size: Number(m[1]), bytes, truncated: Number(m[1]) > bytes.length, binary };
}

export const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
export const mimeOf = p => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' }[(/\.(\w+)$/.exec(p) || [])[1]?.toLowerCase()] || 'application/octet-stream');
