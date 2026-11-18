// Questions the model puts to the person (or to the agent orchestrating the
// session over the bridge), answered on a card. A question is
//   {id, prompt, type, options?, default?, min?, max?, schema?, optional?}
// type: text | number | choice (one of options) | multi (any of options) |
//       confirm (yes/no) | json (a value that satisfies `schema`, a JSON Schema subset).
// Answers are validated here before they go back, whoever gives them.

export const TYPES = ['text', 'number', 'choice', 'multi', 'confirm', 'json'];

// The JSON Schema subset the json type checks: type, enum, const, required,
// properties, additionalProperties:false, items, minimum, maximum, minLength,
// maxLength, minItems, maxItems.
export function check(v, sc, at = '$') {
  if (!sc || typeof sc !== 'object') return [];
  const errs = [], t = Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;
  if (sc.type) {
    const ok = [].concat(sc.type).some(x => x === t || (x === 'number' && t === 'integer'));
    if (!ok) return [`${at}: expected ${[].concat(sc.type).join('|')}, got ${t}`];
  }
  if (sc.enum && !sc.enum.some(x => JSON.stringify(x) === JSON.stringify(v))) errs.push(`${at}: must be one of ${JSON.stringify(sc.enum)}`);
  if ('const' in sc && JSON.stringify(sc.const) !== JSON.stringify(v)) errs.push(`${at}: must be ${JSON.stringify(sc.const)}`);
  if (typeof v === 'number') {
    if (sc.minimum != null && v < sc.minimum) errs.push(`${at}: below ${sc.minimum}`);
    if (sc.maximum != null && v > sc.maximum) errs.push(`${at}: above ${sc.maximum}`);
  }
  if (typeof v === 'string') {
    if (sc.minLength != null && v.length < sc.minLength) errs.push(`${at}: shorter than ${sc.minLength}`);
    if (sc.maxLength != null && v.length > sc.maxLength) errs.push(`${at}: longer than ${sc.maxLength}`);
  }
  if (Array.isArray(v)) {
    if (sc.minItems != null && v.length < sc.minItems) errs.push(`${at}: fewer than ${sc.minItems} items`);
    if (sc.maxItems != null && v.length > sc.maxItems) errs.push(`${at}: more than ${sc.maxItems} items`);
    if (sc.items) v.forEach((x, i) => errs.push(...check(x, sc.items, `${at}[${i}]`)));
  }
  if (t === 'object') {
    for (const k of sc.required || []) if (!(k in v)) errs.push(`${at}.${k}: required`);
    for (const [k, s2] of Object.entries(sc.properties || {})) if (k in v) errs.push(...check(v[k], s2, `${at}.${k}`));
    if (sc.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in (sc.properties || {}))) errs.push(`${at}.${k}: not allowed`);
  }
  return errs;
}

// Normalize what the model sent; returns {questions} or {error}.
export function questions(args) {
  const qs = Array.isArray(args?.questions) ? args.questions : args?.prompt ? [args] : [];
  if (!qs.length) return { error: 'give questions: [{id, prompt, type, ...}]' };
  const out = [];
  for (const [i, q] of qs.slice(0, 12).entries()) {
    const type = TYPES.includes(q.type) ? q.type : 'text';
    if ((type === 'choice' || type === 'multi') && !(Array.isArray(q.options) && q.options.length)) return { error: `question ${q.id || i + 1}: ${type} needs options` };
    out.push({ id: String(q.id || 'q' + (i + 1)).slice(0, 40), prompt: String(q.prompt || '').slice(0, 500), type,
      options: (q.options || []).slice(0, 30).map(o => String(o).slice(0, 120)), default: q.default, min: q.min, max: q.max, schema: q.schema, optional: !!q.optional });
  }
  return { questions: out };
}

// Validate a full answer set {id: value}; returns {answers} or {errors}.
export function validate(qs, given) {
  const answers = {}, errors = [];
  for (const q of qs) {
    let v = given?.[q.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (q.optional) continue; if (q.type !== 'confirm' && q.type !== 'multi') { errors.push(`${q.id}: an answer is required`); continue; } }
    if (q.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) { errors.push(`${q.id}: not a number`); continue; }
      if (q.min != null && v < q.min) errors.push(`${q.id}: below ${q.min}`);
      if (q.max != null && v > q.max) errors.push(`${q.id}: above ${q.max}`);
    } else if (q.type === 'choice') {
      if (!q.options.includes(v)) errors.push(`${q.id}: not one of the options`);
    } else if (q.type === 'multi') {
      v = [].concat(v ?? []).map(String);
      if (v.some(x => !q.options.includes(x))) errors.push(`${q.id}: not among the options`);
    } else if (q.type === 'confirm') {
      v = v === true || v === 'true' || v === 'yes';
    } else if (q.type === 'json') {
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { errors.push(`${q.id}: not valid JSON (${e.message})`); continue; } }
      errors.push(...check(v, q.schema).map(e => `${q.id} ${e}`));
    } else v = String(v);
    answers[q.id] = v;
  }
  return errors.length ? { errors } : { answers };
}

// The form for a card; read() returns the raw values by id.
export function form(qs, h) {
  const rows = qs.map(q => {
    let input;
    if (q.type === 'choice') input = h('div', { class: 'opts' }, ...q.options.map(o => h('label', { class: 'check' }, Object.assign(h('input', { type: 'radio', name: 'ask-' + q.id, value: o }), { checked: q.default === o }), ' ' + o)));
    else if (q.type === 'multi') input = h('div', { class: 'opts' }, ...q.options.map(o => h('label', { class: 'check' }, Object.assign(h('input', { type: 'checkbox', name: 'ask-' + q.id, value: o }), { checked: [].concat(q.default || []).includes(o) }), ' ' + o)));
    else if (q.type === 'confirm') input = h('div', { class: 'opts' }, ...['yes', 'no'].map(o => h('label', { class: 'check' }, Object.assign(h('input', { type: 'radio', name: 'ask-' + q.id, value: o }), { checked: (q.default === true && o === 'yes') || (q.default === false && o === 'no') }), ' ' + o)));
    else if (q.type === 'json') input = Object.assign(h('textarea', { name: 'ask-' + q.id, rows: '4', class: 'mono', placeholder: q.schema ? 'JSON matching: ' + JSON.stringify(q.schema).slice(0, 200) : 'JSON' }), { value: q.default != null ? JSON.stringify(q.default, null, 1) : '' });
    else if (q.type === 'number') input = h('input', { type: 'number', name: 'ask-' + q.id, ...(q.min != null ? { min: q.min } : {}), ...(q.max != null ? { max: q.max } : {}), value: q.default ?? '' });
    else input = Object.assign(h('textarea', { name: 'ask-' + q.id, rows: '2' }), { value: q.default ?? '' });
    return h('div', { class: 'askq', 'data-q': q.id }, h('div', { class: 'askp' }, h('span', { class: 'qtype', text: q.type }), h('span', { text: ' ' + q.prompt + (q.optional ? ' (optional)' : '') })), input);
  });
  const read = root => Object.fromEntries(qs.map(q => {
    const els = [...root.querySelectorAll(`[name="ask-${CSS.escape(q.id)}"]`)];
    if (q.type === 'multi') return [q.id, els.filter(e => e.checked).map(e => e.value)];
    if (q.type === 'choice' || q.type === 'confirm') return [q.id, els.find(e => e.checked)?.value ?? null];
    return [q.id, els[0]?.value ?? ''];
  }));
  return { rows, read };
}
