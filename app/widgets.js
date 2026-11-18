// Built-in widgets for the stage pane. A widget is { kind, title, data }.
//   render(kind, data, emit) -> Element     emit(value) reports a user interaction
// Nothing here loads a remote URL without a click: a model-chosen URL would
// otherwise reveal the user's address to that host, and could carry data out.

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'text' ? e.textContent = v : e.setAttribute(k, v);
  e.append(...kids);
  return e;
};
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };

function remote(url, make) {
  let u;
  try { u = new URL(String(url)); } catch { return h('p', { class: 'note', text: 'Invalid URL.' }); }
  if (u.protocol === 'data:' && /^data:image\//.test(u.href)) return make(u.href);
  if (u.protocol !== 'https:') return h('p', { class: 'note', text: 'Only https URLs can be shown.' });
  const box = h('div', { class: 'gate' });
  const b = h('button', { type: 'button', text: 'Load from ' + u.host });
  b.addEventListener('click', () => box.replaceWith(make(u.href)));
  box.append(b, h('span', { class: 'note', text: ' ' + u.href.slice(0, 120) }));
  return box;
}

// srcdoc iframe without allow-same-origin: it cannot read this page or its storage.
// emit(value) inside the widget reports an interaction to the host.
const EMIT = '<script>window.emit=function(v){parent.postMessage({wh:1,data:v},"*")}<\/script>';

export const kinds = {
  html: d => h('iframe', { sandbox: 'allow-scripts', srcdoc: EMIT + String(d.html || '') }),
  text: d => h('div', { class: 'txt', text: String(d.text || '') }),
  image: d => remote(d.url, src => h('img', { src, alt: String(d.alt || '') })),
  audio: d => remote(d.url, src => h('audio', { src, controls: '' })),
  video: d => remote(d.url, src => h('video', { src, controls: '' })),
  embed: d => remote(d.url, src => h('iframe', { src, sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups', allow: 'fullscreen; encrypted-media', referrerpolicy: 'no-referrer' })),
  table(d) {
    const cols = d.columns || (d.rows?.[0] && !Array.isArray(d.rows[0]) ? Object.keys(d.rows[0]) : []);
    const cell = (r, c, i) => String((Array.isArray(r) ? r[i] : r?.[c]) ?? '');
    return h('table', { class: 'wtable' },
      h('tr', {}, ...cols.map(c => h('th', { text: String(c) }))),
      ...(d.rows || []).slice(0, 500).map(r => h('tr', {}, ...(cols.length ? cols : r).map((c, i) => h('td', { text: cols.length ? cell(r, c, i) : String(c) })))));
  },
  chart(d) {
    const vals = (d.values || []).map(Number).filter(Number.isFinite), labels = d.labels || [];
    if (!vals.length) return h('p', { class: 'note', text: 'No values.' });
    const W = 320, H = 160, pad = 22, max = Math.max(...vals, 0), min = Math.min(...vals, 0), span = max - min || 1;
    const y = v => pad + (H - 2 * pad) * (1 - (v - min) / span), step = (W - 2 * pad) / vals.length;
    const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wchart', role: 'img' });
    el.append(svg('line', { x1: pad, x2: W - pad, y1: y(0), y2: y(0), class: 'axis' }));
    if (d.type === 'line') el.append(svg('polyline', { class: 'line', points: vals.map((v, i) => `${pad + step * (i + .5)},${y(v)}`).join(' ') }));
    vals.forEach((v, i) => {
      const x = pad + step * i;
      if (d.type !== 'line') el.append(svg('rect', { x: x + step * .15, width: step * .7, y: Math.min(y(v), y(0)), height: Math.abs(y(v) - y(0)), class: 'bar' }));
      if (vals.length <= 12) {
        el.append(svg('text', { x: x + step / 2, y: H - 6, class: 'lbl' }, String(labels[i] ?? i + 1).slice(0, 8)));
        el.append(svg('text', { x: x + step / 2, y: y(v) - 4, class: 'lbl' }, String(+v.toPrecision(4))));
      }
    });
    return el;
  },
  form(d, emit) {
    const f = h('form', { class: 'wform' });
    for (const x of (d.fields || []).slice(0, 30)) {
      const name = String(x.name || ''), a = { name };
      let input;
      if (x.type === 'select') { input = h('select', a, ...(x.options || []).map(o => h('option', { value: String(o), text: String(o) }))); if (x.value != null) input.value = String(x.value); }
      else if (x.type === 'textarea') { input = h('textarea', { ...a, rows: '3' }); input.value = String(x.value ?? ''); }
      else if (x.type === 'checkbox') { input = h('input', { ...a, type: 'checkbox' }); input.checked = !!x.value; }
      else { input = h('input', { ...a, type: x.type === 'number' ? 'number' : 'text' }); input.value = String(x.value ?? ''); }
      f.append(h('label', {}, h('span', { text: String(x.label || name) }), input));
    }
    f.append(h('button', { text: String(d.submit || 'Submit') }));
    f.addEventListener('submit', e => {
      e.preventDefault();
      const out = {};
      for (const el of f.elements) if (el.name) out[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' && el.value !== '' ? Number(el.value) : el.value;
      emit(out);
    });
    return f;
  },
};

export function render(kind, data, emit) {
  const make = kinds[kind];
  if (!make) return h('p', { class: 'note', text: `Unknown widget kind "${kind}".` });
  try { return make(data && typeof data === 'object' ? data : {}, emit); }
  catch (e) { return h('p', { class: 'note', text: 'Widget failed: ' + e.message }); }
}
