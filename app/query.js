// Query surface (docs/QUERY.md): a GraphQL-subset read surface over adapters. Pure ES module: parse, validate, execute, ref.
// createSurface({adapters, now, policy?, reducers?, reader?, prefaced?}) -> {run, ref, audit, tick, synopsis}.
// An adapter is data plus functions (schema, kinds, resolve); the surface does not know which one it holds.
import { parse } from './query-parse.js';
import { mergeAdapters, synopsis } from './query-schema.js';
import { validate } from './query-validate.js';
import { makeRegistry } from './query-reducers.js';
import { execute } from './query-exec.js';
import { settleLabels, buildBlocks, refRows, buildHeader } from './query-header.js';
import { createGate } from './query-ref.js';

export { RegistrationError } from './query-schema.js';

export function createSurface(opts = {}) {
  const schema = mergeAdapters(opts.adapters || []), policy = opts.policy || {}, registry = makeRegistry(opts.reducers);
  const now = opts.now || Date.now, sent = new Set(), text = () => synopsis(schema);
  let n = 0;
  const gate = createGate({ schema, policy, registry, now, counter: () => n, ctx: () => ({ reader: opts.reader, now, vars: {} }) });

  async function run(src, ro = {}) {
    const q = 'q' + ++n;
    const bad = errors => { const r = { header: { v: 1, q, ok: false }, errors }; gate.logRun(q, r); return r; };
    const p = parse(src);
    if (p.error) return bad([p.error]);
    const v = validate({ ast: p.ast, variables: ro.variables, schema, policy, registry });
    if (v.errors.length) return bad(v.errors);
    const env = { schema, policy, registry, synopsis: text, prefaced: opts.prefaced, sent, ctx: { reader: opts.reader, now, vars: v.plan.vars } };
    const { data, st } = await execute(v.plan, env);
    const prefixed = settleLabels(st), blocks = buildBlocks(st, env, prefixed), refs = refRows(st, env);
    const header = buildHeader({ q, plan: v.plan, st, env, errors: st.errors, blocks, refs: refs.rows, dropped: refs.dropped });
    const result = { header, data, ...(st.errors.length ? { errors: st.errors } : {}) };
    gate.remember(q, n, st, refs.rows);
    gate.logRun(q, result);
    return result;
  }

  return { run, ref: gate.ref, audit: gate.audit, tick: gate.tick, synopsis: text };
}
