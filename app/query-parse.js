// Query surface, parse stage: lexer and recursive-descent parser for the GraphQL subset of docs/QUERY.md section 1.
// Pure: text in, AST or one PARSE error out. Nothing here knows a schema.
const PUNCT = '!$():=@[]{|}';
const OUT_WORDS = new Set(['mutation', 'subscription', 'interface', 'union', 'extend', 'type', 'scalar', 'directive', 'enum', 'input', 'schema']);
const NAME_START = /[_A-Za-z]/, NAME_REST = /[_0-9A-Za-z]/, DIGIT = /[0-9]/;
const ESC = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

class ParseFail extends Error { constructor(message, line, column) { super(message); this.line = line; this.column = column; } }
const fail = (message, tok) => { throw new ParseFail(message, tok.line, tok.col); };

function readString(src, i, at) {
  let out = '', j = i + 1;
  for (;;) {
    const c = src[j];
    if (c === undefined || c === '\n') fail('unterminated string', at);
    if (c === '"') return { v: out, end: j + 1 };
    if (c !== '\\') { out += c; j++; continue; }
    const e = src[j + 1];
    if (e === 'u') {
      const hex = src.slice(j + 2, j + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape', at);
      out += String.fromCharCode(parseInt(hex, 16)); j += 6;
    } else if (e in ESC) { out += ESC[e]; j += 2; }
    else fail('bad escape in string', at);
  }
}

function readNumber(src, i, at) {
  let j = i + (src[i] === '-' ? 1 : 0), float = false;
  if (!DIGIT.test(src[j] || '')) fail('bad number', at);
  while (DIGIT.test(src[j] || '')) j++;
  if (src[j] === '.') { float = true; j++; if (!DIGIT.test(src[j] || '')) fail('bad number', at); while (DIGIT.test(src[j] || '')) j++; }
  if (src[j] === 'e' || src[j] === 'E') { float = true; j++; if (src[j] === '+' || src[j] === '-') j++; if (!DIGIT.test(src[j] || '')) fail('bad number', at); while (DIGIT.test(src[j] || '')) j++; }
  if (NAME_START.test(src[j] || '')) fail('bad number', at);
  const v = Number(src.slice(i, j));
  if (!float && Math.abs(v) > 2147483647) fail('Int out of range (32-bit)', at);
  return { t: float ? 'float' : 'int', v, end: j };
}

export function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const adv = n => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  while (i < src.length) {
    const c = src[i], at = { line, col };
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === ',' || c === '\uFEFF') { adv(1); continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') adv(1); continue; }
    if (src.startsWith('...', i)) { toks.push({ t: 'spread', v: '...', ...at }); adv(3); continue; }
    if (c === '"') {
      if (src.startsWith('"""', i)) fail('unsupported: block string', at);
      const s = readString(src, i, at); toks.push({ t: 'string', v: s.v, ...at }); adv(s.end - i); continue;
    }
    if (c === '-' || DIGIT.test(c)) { const n = readNumber(src, i, at); toks.push({ t: n.t, v: n.v, ...at }); adv(n.end - i); continue; }
    if (NAME_START.test(c)) { let j = i + 1; while (NAME_REST.test(src[j] || '')) j++; toks.push({ t: 'name', v: src.slice(i, j), ...at }); adv(j - i); continue; }
    if (PUNCT.includes(c)) { toks.push({ t: 'punct', v: c, ...at }); adv(1); continue; }
    fail(`unexpected character ${JSON.stringify(c)}`, at);
  }
  toks.push({ t: 'eof', v: '', line, col });
  return toks;
}

class Parser {
  constructor(toks) { this.toks = toks; this.p = 0; }
  get tok() { return this.toks[this.p]; }
  at(n = 0) { return this.toks[Math.min(this.p + n, this.toks.length - 1)]; }
  isP(c) { return this.tok.t === 'punct' && this.tok.v === c; }
  isName(v) { return this.tok.t === 'name' && (v === undefined || this.tok.v === v); }
  eatP(c) { if (!this.isP(c)) return false; this.p++; return true; }
  expectP(c) { if (!this.eatP(c)) this.unexpected(`"${c}"`); }
  unexpected(want) { const t = this.tok; fail(`expected ${want}, found ${t.t === 'eof' ? 'end of input' : JSON.stringify(String(t.v))}`, t); }
  name() { if (!this.isName()) this.unexpected('a name'); return this.toks[this.p++].v; }
  loc() { return { line: this.tok.line, column: this.tok.col }; }

  doc() {
    const ops = [], frags = [];
    while (this.tok.t !== 'eof') {
      if (this.isP('{')) ops.push(this.operation());
      else if (this.isName('query')) ops.push(this.operation());
      else if (this.isName('fragment')) frags.push(this.fragment());
      else if (this.isName() && OUT_WORDS.has(this.tok.v)) fail('unsupported: ' + this.tok.v, this.tok);
      else this.unexpected('an operation or fragment');
    }
    if (!ops.length && !frags.length) fail('empty query text', this.tok);
    return { ops, frags };
  }
  operation() {
    const loc = this.loc();
    if (this.isP('{')) return { name: null, vars: [], directives: [], sel: this.selSet(), loc };
    this.name();
    const name = this.isName() ? this.name() : null;
    const vars = this.isP('(') ? this.varDefs() : [];
    const directives = this.directives();
    return { name, vars, directives, sel: this.selSet(), loc };
  }
  varDefs() {
    this.expectP('(');
    const out = [];
    do {
      const loc = this.loc();
      this.expectP('$');
      const name = this.name();
      this.expectP(':');
      const type = this.type();
      if (this.isP('@')) fail('unsupported: directive on variable definition', this.tok);
      const def = this.eatP('=') ? this.value() : undefined;
      out.push({ name, type, def, loc });
    } while (!this.isP(')'));
    this.expectP(')');
    return out;
  }
  type() {
    let t;
    if (this.eatP('[')) { t = { kind: 'list', of: this.type(), nn: false }; this.expectP(']'); }
    else t = { kind: 'named', name: this.name(), nn: false };
    if (this.eatP('!')) t.nn = true;
    return t;
  }
  fragment() {
    const loc = this.loc();
    this.name();
    const name = this.name();
    if (name === 'on') fail('a fragment cannot be named "on"', this.at(-1));
    if (!this.isName('on')) this.unexpected('"on"');
    this.p++;
    const on = this.name();
    return { name, on, directives: this.directives(), sel: this.selSet(), loc };
  }
  selSet() {
    this.expectP('{');
    const out = [];
    do out.push(this.selection()); while (!this.isP('}'));
    this.expectP('}');
    return out;
  }
  selection() {
    const loc = this.loc();
    if (this.tok.t === 'spread') {
      this.p++;
      if (this.isName('on') || this.isP('@') || this.isP('{')) fail('unsupported: inline fragment', this.at(-1));
      const name = this.name();
      return { kind: 'spread', name, directives: this.directives(), loc };
    }
    let name = this.name(), alias = null;
    if (this.eatP(':')) { alias = name; name = this.name(); }
    const args = this.isP('(') ? this.args() : [];
    const directives = this.directives();
    return { kind: 'field', alias, name, args, directives, sel: this.isP('{') ? this.selSet() : null, loc };
  }
  args() {
    this.expectP('(');
    const out = [];
    do {
      const loc = this.loc(), name = this.name();
      this.expectP(':');
      out.push({ name, value: this.value(), loc });
    } while (!this.isP(')'));
    this.expectP(')');
    return out;
  }
  directives() {
    const out = [];
    while (this.isP('@')) { const loc = this.loc(); this.p++; const name = this.name(); out.push({ name, args: this.isP('(') ? this.args() : [], loc }); }
    return out;
  }
  value() {
    const t = this.tok, loc = this.loc();
    if (this.eatP('$')) return { k: 'var', name: this.name(), loc };
    if (this.eatP('[')) { const v = []; while (!this.isP(']')) v.push(this.value()); this.p++; return { k: 'list', v }; }
    if (this.eatP('{')) {
      const v = [];
      while (!this.isP('}')) { const key = this.name(); this.expectP(':'); v.push([key, this.value()]); }
      this.p++;
      return { k: 'obj', v };
    }
    if (t.t === 'int' || t.t === 'float' || t.t === 'string') { this.p++; return { k: t.t, v: t.v }; }
    if (t.t === 'name') {
      this.p++;
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true' };
      return t.v === 'null' ? { k: 'null' } : { k: 'enum', v: t.v };
    }
    this.unexpected('a value');
  }
}

// -> {ast} or {error} (the error is already in the one error shape of QUERY.md 1.5)
export function parse(text) {
  try { return { ast: new Parser(lex(String(text))).doc() }; }
  catch (e) {
    if (!(e instanceof ParseFail)) throw e;
    return { error: { message: e.message, locations: [{ line: e.line, column: e.column }], extensions: { code: 'PARSE', stage: 'parse' } } };
  }
}

// AST value -> plain JS value; a variable reads from `vars`
export function jsValue(n, vars) {
  switch (n.k) {
    case 'var': return vars ? vars[n.name] : undefined;
    case 'list': return n.v.map(x => jsValue(x, vars));
    case 'obj': return Object.fromEntries(n.v.map(([k, x]) => [k, jsValue(x, vars)]));
    case 'null': return null;
    default: return n.v;
  }
}
