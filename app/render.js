// Render plugins: how the parts of a session (messages, tool calls, approvals,
// held steps, flags) become DOM. The default look is a plugin too
// (render-defaults.js); a developer's templates and text transforms sit on top.
// Spec: docs/RENDER-PLUGINS.md. Model and tool text is only ever a text node;
// markup comes only from templates and transforms, and passes the sanitizer
// below (strings, JSON specs) or the guard (nodes from code plugins).

import { rule } from './styles.js';

const LS = 'wh:render';
const NS_HTML = 'http://www.w3.org/1999/xhtml';
export const PARTS = ['user', 'assistant', 'tool-call', 'tool-result', 'approval', 'held', 'flag', 'reasoning'];
const FRAMES = new Set(['user', 'assistant', 'tool-result', 'approval', 'held']);
const ENFORCED = { approval: ['what', 'controls'], held: ['what', 'controls'] }; // slots a template cannot leave out
const DEFAULT_SCOPE = ['assistant', 'user', 'tool-result'];
const MAX_NODES = 5000, MAX_DEPTH = 30, MAX_TEXT = 400000, MAX_SPEC = 65536;
export const STYLE_PROPS = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'font-size', 'opacity'];

// ---------- small DOM helper (safe by construction) ----------

export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (!/^on/i.test(k)) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.filter(x => x != null && x !== false));
  return e;
};

// ---------- the sanitizer: allowlist, rebuilt from scratch ----------
// Markup is parsed in an inert document and read into a plain data tree; the
// output is built with createElement from that tree. Nothing parsed is carried
// over, and nothing is serialized and re-parsed (no mutation XSS).

const ALLOW = new Set('a abbr b blockquote br button code del details div em figcaption figure h3 h4 h5 h6 hr i img kbd li mark ol p pre s small span strong sub summary sup table tbody td tfoot th thead tr u ul'.split(' '));
// dropped with their content (anything else unknown is unwrapped: its text stays)
const DROP = new Set('script style link meta base iframe frame frameset object embed applet template noscript form input textarea select option optgroup svg math head title audio video source track canvas dialog portal slot xmp plaintext noembed noframes area map marquee'.split(' '));
const GUARD_DROP = new Set('script style link meta base iframe frame frameset object embed applet template noscript form'.split(' '));
const GLOBAL_ATTRS = new Set(['class', 'title', 'lang', 'dir', 'style']);
const TAG_ATTRS = { a: ['href'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'], details: ['open'], button: ['type', 'disabled', 'data-copy-text'] };
const CLASS_OK = /^rp-[a-z0-9_-]{1,40}$/;
const SAFE_CLASS = new Set(['note', 'bad', 'ok', 'mono', 'meta', 'name', 'txt', 'think']);
const APP_CLASS = new Set(['chip', 'card', 'stagebox', 'modal', 'modal-back', 'slot']); // classes the app binds behaviour or full-screen layout to
const INVIS = new RegExp("[\u0000-\u0020\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]", "g");
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|var\(--[a-z0-9-]{1,30}\))$/i;
const STYLE_RX = { color: COLOR, 'background-color': COLOR, 'font-weight': /^(normal|bold|[1-9]00)$/, 'font-style': /^(normal|italic)$/, 'text-decoration': /^(none|underline|line-through)$/, 'font-size': /^\d{1,3}(\.\d{1,2})?(px|em|rem|%)$/, opacity: /^(0|1|0?\.\d{1,2})$/ };

export function safeHref(v) {
  const c = String(v).replace(INVIS, '');
  if (c.length > 2000) return null;
  if (/^#[\w-]{0,80}$/.test(c)) return c;
  if (!/^(https?:|mailto:)/i.test(c)) return null;
  try { return /^(https?:|mailto:)$/.test(new URL(c).protocol) ? c : null; } catch { return null; }
}
export function safeImg(v) {
  const c = String(v).trim();
  return c.length <= 150000 && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(c) ? c : null;
}
export function cleanStyle(v, allowed) {
  if (!allowed || !allowed.size) return null;
  const out = [];
  for (const d of String(v).split(';')) {
    if (!d.trim()) continue;
    const i = d.indexOf(':');
    if (i < 0) continue;
    const k = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim();
    if (allowed.has(k) && STYLE_RX[k]?.test(val)) out.push(`${k}:${val}`);
  }
  return out.length ? out.join(';') : null;
}

function attrValue(k, v, o) {
  v = String(v);
  switch (k) {
    case 'class': { const t = v.split(/\s+/).filter(x => CLASS_OK.test(x) || SAFE_CLASS.has(x)); return t.length ? t.join(' ') : null; }
    case 'title': case 'alt': return v.slice(0, 500);
    case 'lang': return /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i.test(v) ? v : null;
    case 'dir': return /^(ltr|rtl|auto)$/.test(v) ? v : null;
    case 'href': return safeHref(v);
    case 'src': return safeImg(v);
    case 'width': case 'height': return /^\d{1,4}$/.test(v) ? v : null;
    case 'colspan': case 'rowspan': return /^[1-9]\d?$/.test(v) ? v : null;
    case 'start': return /^\d{1,5}$/.test(v) ? v : null;
    case 'open': case 'disabled': return '';
    case 'type': return 'button';
    case 'data-copy-text': return v.slice(0, 20000);
    case 'style': return cleanStyle(v, o.styles);
  }
  return null;
}

const parseHTML = str => new DOMParser().parseFromString('<!doctype html><body>' + str, 'text/html').body;

// markup -> data tree: [{t:'text',v} | {t:'el',tag,attrs,kids} | {t:'slot',name}]
function toTree(parent, o, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('markup is nested too deeply');
  const out = [];
  for (const c of parent.childNodes) {
    if (++o.n > MAX_NODES) throw new Error('markup has too many nodes');
    if (c.nodeType === 3) { out.push({ t: 'text', v: c.data }); continue; }
    if (c.nodeType !== 1 || c.namespaceURI !== NS_HTML) continue; // comments; svg and math with everything inside
    const tag = c.localName;
    if (DROP.has(tag)) continue;
    if (o.allowSlot && c.hasAttribute('data-slot')) { const name = c.getAttribute('data-slot'); if (/^[a-z]{2,12}$/.test(name)) out.push({ t: 'slot', name }); continue; }
    const kids = toTree(c, o, depth + 1);
    if (!ALLOW.has(tag)) { out.push(...kids); continue; }
    const attrs = {};
    for (const a of c.attributes) { const k = a.name.toLowerCase(); if (GLOBAL_ATTRS.has(k) || TAG_ATTRS[tag]?.includes(k)) attrs[k] = a.value; }
    out.push({ t: 'el', tag, attrs, kids });
  }
  return out;
}

// data tree -> DOM. o: {sub(str) for placeholders, styles:Set, slots:{name:[Node]}, used:Set}
function build(tree, o) {
  const frag = document.createDocumentFragment();
  for (const n of tree) {
    if (n.t === 'text') { frag.append(document.createTextNode(o.sub ? o.sub(n.v) : n.v)); continue; }
    if (n.t === 'slot') { o.used?.add(n.name); for (const x of o.slots?.[n.name] || []) frag.append(x); continue; }
    const el = document.createElement(n.tag);
    let bad = false;
    for (const [k, v] of Object.entries(n.attrs)) {
      const val = attrValue(k, o.sub ? o.sub(v) : v, o);
      if (val == null) { if (n.tag === 'img' && k === 'src') bad = true; continue; }
      el.setAttribute(k, val);
    }
    if (bad) { if (n.attrs.alt) frag.append(document.createTextNode(String(o.sub ? o.sub(n.attrs.alt) : n.attrs.alt).slice(0, 500))); continue; }
    if (n.tag === 'a' && el.hasAttribute('href')) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer nofollow'); }
    if (n.tag === 'button') el.setAttribute('type', 'button');
    el.append(build(n.kids, o));
    frag.append(el);
  }
  return frag;
}

const textFrag = s => { const f = document.createDocumentFragment(); if (s) f.append(String(s)); return f; };

// A string of markup -> a safe DocumentFragment. Too big or too deep: shown as text.
export function sanitize(markup, opt = {}) {
  const str = String(markup ?? '');
  try {
    if (str.length > 200000) throw new Error('markup is too long');
    return build(toTree(parseHTML(str), { n: 0 }), { styles: new Set(opt.styles || []) });
  } catch (e) { logErr(opt.plugin || '-', 'sanitize', e); return textFrag(str.slice(0, 20000)); }
}

// ---------- the guard: nodes returned by code plugins ----------
// A code plugin is code; the guard catches the usual accident (innerHTML with
// model text) and removes what could run or hijack the app's own handlers.

const owned = new WeakSet(); // nodes the harness built (slots); the guard leaves them alone

function cleanAttrs(el, styles) {
  const tag = el.localName;
  for (const a of [...el.attributes]) {
    const k = a.name.toLowerCase(), v = a.value;
    if (/^on/.test(k) || ['srcdoc', 'id', 'name', 'formaction', 'action', 'srcset', 'ping', 'background', 'contenteditable', 'xlink:href', 'poster', 'data'].includes(k)) { el.removeAttribute(a.name); continue; }
    if (k === 'href' || k === 'src') {
      const ok = k === 'href' && tag === 'a' ? safeHref(v) : k === 'src' && tag === 'img' ? safeImg(v) : null;
      if (ok == null) el.removeAttribute(a.name); else if (ok !== v) el.setAttribute(a.name, ok);
      continue;
    }
    if (k === 'style') { const s = cleanStyle(v, styles); s ? el.setAttribute('style', s) : el.removeAttribute('style'); continue; }
    if (k === 'class') { const t = v.split(/\s+/).filter(x => x && !APP_CLASS.has(x)); t.length ? el.setAttribute('class', t.join(' ')) : el.removeAttribute('class'); continue; }
    if (k.startsWith('data-') && k !== 'data-copy-text' && !k.startsWith('data-rp-')) el.removeAttribute(a.name);
  }
  if (tag === 'a' && el.hasAttribute('href')) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer nofollow'); }
}
export function guard(root, styles) {
  const sty = styles instanceof Set ? styles : new Set(styles || []);
  const bad = n => n.namespaceURI !== NS_HTML || GUARD_DROP.has(n.localName);
  const walk = (n, d) => {
    for (const c of [...n.childNodes]) {
      if (owned.has(c)) continue;
      if (c.nodeType === 1) {
        if (bad(c) || d > MAX_DEPTH * 4) { c.remove(); continue; }
        cleanAttrs(c, sty);
        walk(c, d + 1);
      } else if (c.nodeType !== 3) c.remove();
    }
  };
  if (owned.has(root)) return root;
  if (root.nodeType === 1) { if (bad(root)) return null; cleanAttrs(root, sty); }
  else if (root.nodeType !== 11 && root.nodeType !== 3) return null;
  walk(root, 0);
  return root;
}

// ---------- registry ----------

const plugins = new Map(); // id -> plugin
let order = [];            // user plugin ids, top first
let on = {};               // 'id' and 'id/transform' -> bool
let specs = [];            // pasted specs, as stored
const listeners = new Set();
const errs = [];
let cache = new Map();

function logErr(plugin, where, e) {
  errs.push({ t: Date.now(), plugin, where, message: String(e?.message || e) });
  if (errs.length > 50) errs.shift();
}
export const errors = () => errs.slice();

function store() {
  try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && j.v === 1 && typeof j === 'object') return j; } catch {}
  return null;
}
function persist() {
  try { localStorage.setItem(LS, JSON.stringify({ v: 1, specs, on, order })); } catch {}
}
function changed() {
  cache = new Map();
  persist();
  for (const f of [...listeners]) { try { f(); } catch (e) { logErr('-', 'onChange', e); } }
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const isOn = p => p.id === 'core-look' || on[p.id] !== false;
const trOn = (p, t) => isOn(p) && (on[p.id + '/' + t.id] ?? t.defaultOn !== false);
const pluginsInOrder = () => [...order.map(id => plugins.get(id)).filter(p => p && !p.builtin), ...[...plugins.values()].filter(p => p.builtin)];

export function enabled(id) { const [p, t] = id.split('/'); const pl = plugins.get(p); if (!pl) return false; const tr = t && pl.transforms.find(x => x.id === t); return tr ? trOn(pl, tr) : isOn(pl); }
export function enable(id, v = true) {
  const [p, t] = id.split('/');
  if (!plugins.has(p) || p === 'core-look') return;
  if (t && !plugins.get(p).transforms.some(x => x.id === t)) return;
  on[id] = !!v;
  changed();
}
export function move(id, delta) {
  const i = order.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  changed();
}
export function list() {
  return pluginsInOrder().map(p => ({ id: p.id, name: p.name, tier: p.tier, builtin: !!p.builtin, spec: !!p.spec, on: isOn(p), locked: p.id === 'core-look',
    templates: Object.keys(p.templates), transforms: p.transforms.map(t => ({ id: t.id, title: t.title, scope: t.scope, on: trOn(p, t) })) }));
}

// ---------- specs: markup templates and regex transforms as data ----------

const PH = /\{\{\s*([A-Za-z0-9_.]{1,40})(?:\|(clip|upper|lower|json)(?::(\d{1,5}))?)?\s*\}\}/g;
const lookup = (data, path) => { let v = data; for (const k of path.split('.')) { if (v == null || typeof v !== 'object' || k === '__proto__' || k === 'constructor') return ''; v = v[k]; } return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''; };
const filt = (v, f, n) => f === 'clip' ? (v.length > Number(n || 80) ? v.slice(0, Number(n || 80)) + '…' : v) : f === 'upper' ? v.toUpperCase() : f === 'lower' ? v.toLowerCase() : f === 'json' ? JSON.stringify(v) : v;
const subData = data => s => s.replace(PH, (_, path, f, n) => filt(lookup(data, path), f, n));

function compileMarkup(markup, label) {
  if (typeof markup !== 'string' || markup.length > 8000) throw new Error(`${label}: markup must be a string of at most 8000 characters`);
  return toTree(parseHTML(markup), { n: 0, allowSlot: true });
}
// Rough guard for a pasted regex: length, nested quantifiers, runs of wildcards.
function checkPattern(pattern, flags, label) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 200) throw new Error(`${label}: pattern must be 1 to 200 characters`);
  if (/\([^()]*[+*][^()]*\)[+*{]/.test(pattern) || /(\.\*|\.\+){3,}/.test(pattern) || /\\[1-9]/.test(pattern)) throw new Error(`${label}: pattern looks like it can run for very long (nested quantifiers or backreference)`);
  if (flags != null && !/^[imsug]{0,5}$/.test(flags)) throw new Error(`${label}: flags may contain only i m s u g`);
  return new RegExp(pattern, [...new Set((flags || '').replace('g', '') + 'g')].join(''));
}

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SPEC_KEYS = new Set(['id', 'name', 'styles', 'templates', 'transforms']);
const TR_KEYS = new Set(['id', 'title', 'scope', 'pattern', 'flags', 'replace', 'text', 'default']);

// Validate and compile a spec into a plugin definition. Throws with the reason.
export function compileSpec(raw) {
  let s = raw;
  if (typeof s === 'string') { if (s.length > MAX_SPEC) throw new Error('the spec is over 64 KB'); try { s = JSON.parse(s); } catch (e) { throw new Error('not valid JSON: ' + e.message); } }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('a spec is a JSON object');
  if (JSON.stringify(s).length > MAX_SPEC) throw new Error('the spec is over 64 KB');
  for (const k of Object.keys(s)) if (!SPEC_KEYS.has(k)) throw new Error(`unknown key "${k}" (a spec has id, name, styles, templates, transforms)`);
  if (typeof s.id !== 'string' || !ID.test(s.id) || s.id.startsWith('core-')) throw new Error('id must be 2 to 40 characters of a-z 0-9 and -, and not start with core-');
  if (s.name != null && (typeof s.name !== 'string' || s.name.length > 80)) throw new Error('name must be a string of at most 80 characters');
  if (s.styles != null && (!Array.isArray(s.styles) || s.styles.some(x => !STYLE_PROPS.includes(x)))) throw new Error('styles may list only: ' + STYLE_PROPS.join(', '));
  const styles = new Set(s.styles || []);
  const tpls = s.templates ?? {}, trs = s.transforms ?? [];
  if (typeof tpls !== 'object' || Array.isArray(tpls) || Object.keys(tpls).length > 12) throw new Error('templates is an object with at most 12 parts');
  if (!Array.isArray(trs) || trs.length > 12) throw new Error('transforms is a list of at most 12');
  const templates = {};
  for (const [part, t] of Object.entries(tpls)) {
    if (!PARTS.includes(part)) throw new Error(`unknown part "${part}" (${PARTS.join(', ')})`);
    templates[part] = { markup: typeof t === 'string' ? t : t?.markup };
    compileMarkup(templates[part].markup, 'template ' + part);
  }
  const transforms = [];
  for (const t of trs) {
    if (!t || typeof t !== 'object') throw new Error('a transform is an object');
    for (const k of Object.keys(t)) if (!TR_KEYS.has(k)) throw new Error(`unknown transform key "${k}"`);
    if (typeof t.id !== 'string' || !/^[a-z0-9-]{1,30}$/.test(t.id) || transforms.some(x => x.id === t.id)) throw new Error('each transform needs its own id (a-z 0-9 -, up to 30)');
    const label = 'transform ' + t.id;
    if ((t.replace == null) === (t.text == null)) throw new Error(`${label}: give either replace (markup) or text`);
    if (t.scope != null && (!Array.isArray(t.scope) || t.scope.some(x => !PARTS.includes(x)))) throw new Error(`${label}: scope is a list of parts`);
    checkPattern(t.pattern, t.flags, label);
    if (t.replace != null) compileMarkup(t.replace, label);
    else if (typeof t.text !== 'string' || t.text.length > 500) throw new Error(`${label}: text must be a string of at most 500 characters`);
    transforms.push({ ...t });
  }
  return { id: s.id, name: s.name || s.id, styles: [...styles], templates, transforms, spec: true };
}

// ---------- register ----------

function cssOk(css) {
  if (typeof css !== 'string' || css.length > 20000) throw new Error('css must be a string of at most 20000 characters');
  if (/@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/?style|\\/i.test(css)) throw new Error('css uses something that is not allowed (@import, expression, javascript:, behavior, backslash escapes)');
  for (const m of css.matchAll(/url\s*\(([^)]*)\)/gi)) if (!/^\s*["']?data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+["']?\s*$/.test(m[1])) throw new Error('css url() may only hold a raster data: image');
}

function templateFn(t, p) {
  if (typeof t === 'function') return { fn: t, tier: p.builtin ? 'builtin' : 'code' };
  const markup = typeof t === 'string' ? t : t?.markup;
  if (typeof markup !== 'string') throw new Error('a template is a function, a markup string or {markup}');
  const tree = compileMarkup(markup, 'template');
  return {
    tier: 'spec',
    fn: (data, ctx) => {
      const used = new Set(), slots = data.slots || {};
      const out = build(tree, { sub: subData(data), styles: p.styles, slots, used });
      out._used = used;
      return out;
    },
  };
}

function transformFn(t, p) {
  if (typeof t.transform === 'function') return { ...t, tier: p.builtin ? 'builtin' : 'code' };
  const re = checkPattern(t.pattern, t.flags, 'transform ' + t.id);
  const tree = t.replace != null ? compileMarkup(t.replace, 'transform ' + t.id) : null;
  return { id: t.id, title: t.title || t.id, scope: t.scope, defaultOn: t.default !== false, tier: 'spec',
    transform: rx(re, m => {
      const sub = s => s.replace(/\$([0-9])/g, (_, i) => m[Number(i)] ?? '');
      return tree ? build(tree, { sub, styles: p.styles }) : sub(t.text);
    }) };
}

function add(def, { builtin = false, front = true } = {}) {
  if (!def || typeof def !== 'object') throw new Error('register takes an object');
  if (typeof def.id !== 'string' || !ID.test(def.id)) throw new Error('id must be 2 to 40 characters of a-z 0-9 and -');
  if (!builtin && def.id.startsWith('core-')) throw new Error('ids starting with core- belong to the harness');
  if (def.css != null) cssOk(def.css);
  const styles = new Set(def.styles || []);
  for (const x of styles) if (!STYLE_PROPS.includes(x)) throw new Error('styles may list only: ' + STYLE_PROPS.join(', '));
  const p = { id: def.id, name: def.name || def.id, builtin, spec: !!def.spec, tier: builtin ? 'builtin' : def.spec ? 'spec' : 'code', styles, css: def.css || '', templates: {}, transforms: [] };
  for (const [part, t] of Object.entries(def.templates || {})) {
    if (!PARTS.includes(part)) throw new Error(`unknown part "${part}"`);
    p.templates[part] = templateFn(t, p);
  }
  const seen = new Set();
  for (const t of def.transforms || []) {
    if (!t || typeof t.id !== 'string' || seen.has(t.id)) throw new Error('each transform needs its own id');
    seen.add(t.id);
    const f = transformFn(t, p);
    p.transforms.push({ id: t.id, title: t.title || t.id, scope: t.scope || DEFAULT_SCOPE, match: t.match, transform: f.transform, defaultOn: f.defaultOn ?? t.defaultOn, tier: f.tier });
  }
  plugins.set(p.id, p);
  if (p.css && typeof document !== 'undefined') rule('rp:' + p.id, p.css);
  if (!builtin) order = front && !order.includes(p.id) ? [p.id, ...order] : order.includes(p.id) ? order : [...order, p.id];
  changed();
  return p;
}

export function unregister(id) {
  const p = plugins.get(id);
  if (!p || p.builtin) return false;
  plugins.delete(id);
  order = order.filter(x => x !== id);
  specs = specs.filter(s => s.id !== id);
  if (p.css && typeof document !== 'undefined') rule('rp:' + id, '');
  changed();
  return true;
}
export function register(def) { add(def); return () => unregister(def.id); }
export function registerBuiltin(def) { add(def, { builtin: true }); }

// A pasted spec: validated, compiled, stored in this browser. Returns {ok, id} or {ok:false, error}.
export function addSpec(raw) {
  try {
    if (specs.length >= 20 && !specs.some(s => s.id === (typeof raw === 'object' ? raw?.id : null))) throw new Error('at most 20 specs');
    const def = compileSpec(raw);
    const stored = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw));
    specs = [...specs.filter(s => s.id !== def.id), stored];
    add(def);
    return { ok: true, id: def.id };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
export const removeSpec = unregister;

export function reset() {
  for (const p of [...plugins.values()]) if (p.spec) { plugins.delete(p.id); if (p.css) rule('rp:' + p.id, ''); }
  specs = []; on = {}; order = order.filter(id => plugins.has(id));
  changed();
}

// ---------- text: the transform pipeline ----------

export function rx(re, fn) {
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
  return (str, ctx) => {
    g.lastIndex = 0;
    const out = [];
    let i = 0, m, n = 0;
    while ((m = g.exec(str)) && n++ < 5000) {
      if (m[0] === '') { g.lastIndex++; continue; }
      if (m.index > i) out.push(str.slice(i, m.index));
      const r = fn(m, ctx);
      out.push(r == null ? m[0] : r);
      i = m.index + m[0].length;
    }
    if (!out.length) return null;
    if (i < str.length) out.push(str.slice(i));
    return out.flat();
  };
}

function active(part) {
  let a = cache.get(part);
  if (!a) {
    a = [];
    for (const p of pluginsInOrder()) for (const t of p.transforms) if (trOn(p, t) && t.scope.includes(part)) a.push({ p, t });
    cache.set(part, a);
  }
  return a;
}

function piece(r, p, tier, sty) {
  const node = n => tier === 'code' ? guard(n, sty) : n;
  if (typeof r === 'string') return { v: r };
  if (r && typeof r === 'object' && typeof r.html === 'string') return { n: sanitize(r.html, { styles: [...sty], plugin: p.id }) };
  if (r && typeof r === 'object' && typeof r.nodeType === 'number') { const n = node(r); return n ? { n } : null; }
  return null;
}

// Text -> DocumentFragment, with the enabled transforms applied. Without any
// enabled transform it is one text node, the same as setting textContent.
export function text(str, opt = {}) {
  const s = typeof str === 'string' ? str : String(str ?? '');
  const part = opt.part || 'assistant', trs = s.length > MAX_TEXT ? [] : active(part);
  if (!trs.length) return textFrag(s);
  const ctx = { part, session: opt.session || '', h };
  let segs = [{ v: s }];
  for (const { p, t } of trs) {
    const next = [];
    for (const sg of segs) {
      if (sg.n || !sg.v) { next.push(sg); continue; }
      try {
        if (t.match && !(typeof t.match === 'function' ? t.match(sg.v, ctx) : (t.match.lastIndex = 0, t.match.test(sg.v)))) { next.push(sg); continue; }
        const r = t.transform(sg.v, ctx);
        if (r == null) { next.push(sg); continue; }
        for (const x of Array.isArray(r) ? r : [r]) { const pc = piece(x, p, t.tier, p.styles); if (pc) next.push(pc); else logErr(p.id, 'transform ' + t.id, 'unusable result'); }
      } catch (e) { logErr(p.id, 'transform ' + t.id, e); next.push(sg); }
      if (next.length > 10000) break;
    }
    segs = next;
  }
  const f = document.createDocumentFragment();
  for (const sg of segs) f.append(sg.n || sg.v);
  return f;
}

// ---------- parts ----------

const takeSlot = (slots, name) => { const f = document.createDocumentFragment(); for (const x of slots?.[name] || []) f.append(x); return f; };

function makeCtx(name, data, p, opt, next) {
  return {
    part: name, session: opt.session || '', plugin: p.id, h,
    text: (str, o) => text(str, { part: name, session: opt.session, ...o }),
    html: (markup, o) => sanitize(markup, { styles: [...p.styles], plugin: p.id, ...o }),
    slot: n => takeSlot(data.slots, n),
    next, render: (pn, d) => part(pn, d, opt),
  };
}

function finish(r, p, t) {
  if (r == null) return null;
  if (typeof r === 'string') return sanitize(r, { styles: [...p.styles], plugin: p.id });
  if (typeof r === 'object' && typeof r.nodeType === 'number') return t.tier === 'code' ? guard(r, p.styles) : r;
  throw new Error('a template returns a node, a markup string or null');
}

function resolve(name, data, list, i, opt) {
  for (let j = i; j < list.length; j++) {
    const p = list[j], t = p.templates[name];
    try {
      const n = finish(t.fn(data, makeCtx(name, data, p, opt, () => resolve(name, data, list, j + 1, opt))), p, t);
      if (n) return { node: n, tier: t.tier };
    } catch (e) { logErr(p.id, name, e); }
  }
  return null;
}

const roleOf = (name, data) => name === 'approval' ? 'approve' : name === 'held' ? 'held' : String(data.role || name);

// A frame is one card in the thread: one Element, class msg, data-role set by
// the harness, and the harness's own slots (controls) kept.
function frame(res, name, data) {
  let el = res.node;
  if (el.nodeType === 11) {
    const els = [...el.children];
    const loose = [...el.childNodes].some(c => c.nodeType === 3 && c.data.trim());
    if (els.length === 1 && !loose) el = els[0];
    else { const w = document.createElement('article'); w.append(el); el = w; }
  } else if (el.nodeType !== 1) { const w = document.createElement('article'); w.append(el); el = w; }
  el.setAttribute('class', ['msg', ...[...el.classList].filter(c => c !== 'msg')].join(' '));
  el.setAttribute('data-role', roleOf(name, data));
  const must = [...(ENFORCED[name] || [])];
  if (res.tier === 'spec' && res.node._used && ['user', 'assistant', 'tool-result'].includes(name)) must.push('body');
  for (const k of must) for (const n of data.slots?.[k] || []) if (!el.contains(n)) el.append(n);
  return el;
}

// Draw one part of a session. data.slots holds nodes the harness already built.
export function part(name, data = {}, opt = {}) {
  if (!PARTS.includes(name)) throw new Error('unknown part ' + name);
  for (const arr of Object.values(data.slots || {})) for (const n of arr) owned.add(n);
  const list = pluginsInOrder().filter(p => isOn(p) && p.templates[name]);
  const res = resolve(name, data, list, 0, opt) || { node: textFrag(String(data.text ?? '')), tier: 'builtin' };
  return FRAMES.has(name) ? frame(res, name, data) : res.node;
}

// ---------- browser glue: copy buttons, the stylesheet, stored specs ----------

if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('[data-copy-text]');
    if (!b) return;
    const was = b.textContent;
    try { navigator.clipboard.writeText(b.getAttribute('data-copy-text')).then(() => { b.textContent = 'copied'; setTimeout(() => { b.textContent = was; }, 900); }, () => {}); } catch {}
  });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./render.css', import.meta.url).href;
  document.head.append(link);
}

(function init() {
  const j = store();
  if (!j) return;
  if (j.on && typeof j.on === 'object') for (const [k, v] of Object.entries(j.on)) if (typeof v === 'boolean' && k.length < 100) on[k] = v;
  if (Array.isArray(j.order)) order = j.order.filter(x => typeof x === 'string' && ID.test(x)).slice(0, 100);
  for (const raw of (Array.isArray(j.specs) ? j.specs : []).slice(0, 20)) {
    try { const def = compileSpec(raw); specs.push(raw); add(def, { front: false }); } catch (e) { logErr('stored-spec', 'load', e); }
  }
})();
