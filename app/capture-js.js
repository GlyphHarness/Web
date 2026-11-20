// Capture provider for JavaScript (docs/concepts/INVENTORY.md, "Capture provider and annotations").
// Extraction only: the source is parsed (vendor-acorn.js) and its declarations are listed as
// symbol entries. No model takes part, and nothing is read but what the caller's `read` returns.
//
// Symbol entry: {name, kind, container, file, range, signature, references_count}
//   kind       function | class | method | field | variable | export
//   container  the name of the enclosing symbol (function, class, or the variable an object
//              literal is bound to); null at module level
//   range      "a-b", 1-based lines, the form repo_read takes as `lines`
//   signature  the declaration head as written, white space collapsed; an export entry starts with `export`
//   references_count  null: not counted here (that needs a language service, INVENTORY.md I6)
// An exported name is its own entry of kind `export` (name = the name importers use), so
// `export { a as b } from './x.js'` is found as b. Module-level variables are listed; locals are
// not, unless they hold a function or a class.
// Loaded on demand by inventory.js, so the parser is not part of the page's start.
import { parse } from './vendor-acorn.js';

export const feature = Object.freeze({
  id: 'js-symbols', applies_to: 'js',
  extracts: 'exported names, functions, classes and their members, module-level variables; signatures and line ranges',
  how: 'ast', cost: 'local parse, no request',
});

const SIG_MAX = 240;
const isFn = n => n?.type === 'FunctionExpression' || n?.type === 'ArrowFunctionExpression';
const SKIP = new Set(['type', 'start', 'end', 'loc', 'range']);

// binding names of a pattern: a, {a, b: c}, [a, ...b], a = 1
function names(p, out = []) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') for (const q of p.properties) names(q.type === 'RestElement' ? q.argument : q.value, out);
  else if (p.type === 'ArrayPattern') for (const q of p.elements) names(q, out);
  else if (p.type === 'RestElement') names(p.argument, out);
  else if (p.type === 'AssignmentPattern') names(p.left, out);
  return out;
}
// a property or member key as a name; null for a computed key
const keyName = (key, computed) => computed || !key ? null
  : key.type === 'Identifier' ? key.name
  : key.type === 'PrivateIdentifier' ? '#' + key.name
  : key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number') ? String(key.value)
  : null;

export function symbols(text, file) {
  let ast;
  const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true };
  try { ast = parse(text, { ...opts, sourceType: 'module' }); }
  catch (e) { try { ast = parse(text, { ...opts, sourceType: 'script' }); } catch { throw e; } } // a plain script is still JavaScript
  const out = [];
  const sig = (from, to) => text.slice(from, to).replace(/\s+/g, ' ').trim().replace(/[;,]$/, '').slice(0, SIG_MAX);
  const add = (name, kind, container, node, signature) => { out.push({ name, kind, container, file, range: `${node.loc.start.line}-${node.loc.end.line}`, signature, references_count: null }); };
  const head = n => sig(n.start, n.body.start); // up to the body: `async function f(a, b)`, `class A extends B`, `f = (a) =>`

  // every child node, in source order
  const each = (node, fn) => {
    for (const k in node) {
      if (SKIP.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') fn(c); }
      else if (v && typeof v.type === 'string') fn(v);
    }
  };
  const inside = (fnNode, name) => { for (const p of fnNode.params) walk(p, name, false); walk(fnNode.body, name, false); };
  const classBody = (cls, name) => {
    if (cls.superClass) walk(cls.superClass, name, false);
    for (const m of cls.body.body) {
      const key = keyName(m.key, m.computed);
      if (m.type === 'MethodDefinition') { if (key) add(key, 'method', name, m, sig(m.start, m.value.body.start)); inside(m.value, key || name); }
      else if (m.type === 'PropertyDefinition') {
        if (key) add(key, isFn(m.value) ? 'method' : 'field', name, m, isFn(m.value) ? sig(m.start, m.value.body.start) : sig(m.start, m.key.end));
        if (isFn(m.value)) inside(m.value, key || name); else if (m.value) walk(m.value, name, false);
      } else walk(m, name, false); // a static block
    }
  };
  // a declaration: its symbols, and (when exported) one export entry per bound name
  const declare = (d, container, top, exported) => {
    const ex = exported ? 'export ' : '';
    if (d.type === 'FunctionDeclaration') {
      if (d.id) { add(d.id.name, 'function', container, d, head(d)); if (exported) add(d.id.name, 'export', null, d, ex + head(d)); }
      inside(d, d.id?.name ?? container);
    } else if (d.type === 'ClassDeclaration') {
      if (d.id) { add(d.id.name, 'class', container, d, head(d)); if (exported) add(d.id.name, 'export', null, d, ex + head(d)); }
      classBody(d, d.id?.name ?? container);
    } else if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) {
        const one = v.id.type === 'Identifier' ? v.id.name : null;
        if (one && isFn(v.init)) {
          const s = `${d.kind} ${sig(v.start, v.init.body.start)}`;
          add(one, 'function', container, v, s); if (exported) add(one, 'export', null, v, ex + s);
          inside(v.init, one);
        } else if (one && v.init?.type === 'ClassExpression') {
          const s = `${d.kind} ${sig(v.start, v.init.body.start)}`;
          add(one, 'class', container, v, s); if (exported) add(one, 'export', null, v, ex + s);
          classBody(v.init, one);
        } else {
          for (const n of names(v.id)) {
            if (top) add(n, 'variable', container, v, `${d.kind} ${n}`);
            if (exported) add(n, 'export', null, v, `${ex}${d.kind} ${n}`);
          }
          if (v.id.type !== 'Identifier') walk(v.id, container, false); // defaults inside a pattern
          if (v.init) walk(v.init, top && one ? one : container, false);
        }
      }
    }
  };
  function walk(node, container, top) {
    switch (node.type) {
      case 'FunctionDeclaration': case 'ClassDeclaration': case 'VariableDeclaration':
        return declare(node, container, top, false);
      case 'ExportNamedDeclaration':
        if (node.declaration) return declare(node.declaration, container, top, true);
        for (const s of node.specifiers) add(s.exported.name ?? String(s.exported.value), 'export', null, s, sig(node.start, node.end));
        return;
      case 'ExportDefaultDeclaration': {
        const d = node.declaration, named = (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration');
        add('default', 'export', null, node, named || isFn(d) || d.type === 'ClassExpression' ? sig(node.start, d.body.start) : sig(node.start, node.end));
        if (named) return declare(d, container, top, false);
        return walk(d, container, false);
      }
      case 'ExportAllDeclaration':
        return add(node.exported ? node.exported.name ?? String(node.exported.value) : '*', 'export', null, node, sig(node.start, node.end));
      case 'ClassExpression':
        return classBody(node, node.id?.name ?? container);
      case 'Property': {
        // a function held by an object literal: a member of whatever the literal is bound to
        const key = keyName(node.key, node.computed);
        if (isFn(node.value) && key) { add(key, 'method', container, node, sig(node.start, node.value.body.start)); return inside(node.value, key); }
        if (node.computed) walk(node.key, container, false);
        return walk(node.value, container, false);
      }
      default:
        // nested blocks keep module level for `top` only when they are the program itself
        return each(node, c => walk(c, container, top && node.type === 'Program'));
    }
  }
  walk(ast, null, true);
  return out;
}

export const provider = Object.freeze({
  id: 'js-acorn', language: 'js', feature,
  // params {language, scope: [paths or labels], op}; env {read(label) -> Promise<string>}
  async run({ scope = [], op = 'capture' } = {}, { read } = {}) {
    if (op !== 'capture') throw new Error(`js-acorn: "${op}" is not built; this provider captures only`);
    const symbol_entries = [];
    for (const file of scope) {
      const text = await read(file);
      try { symbol_entries.push(...symbols(String(text), file)); }
      catch (e) { throw new Error(`${file}: ${e.message || e}`); }
    }
    return { symbol_entries, reference_edges: [], annotations: [] };
  },
});
