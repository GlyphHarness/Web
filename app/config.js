// Paste-to-configure: a JSON block (from a reply, a note, another browser) merged
// into the settings. Only the fields below are accepted; anything that looks like
// a credential is refused and never applied. Policies merge by name: a known name
// takes the fields given, a new name is added, {"name", "remove": true} drops it.
//
//   {"webharness": "config", "settings": {"model": "...", "logRepo": "owner/name"},
//    "policies": [{"name": "bounded-waits", "on": false}]}
// A bare object is read as settings (plus "policies" if present).

const S = v => typeof v === 'string';
export const FIELDS = {
  provider: { check: (v, ctx) => S(v) && ctx.providers.includes(v), hint: 'one of the providers' },
  model: { check: S }, helper: { check: S }, policyModel: { check: S },
  ghlabel: { check: S, hint: 'label told to the model' },
  logRepo: { check: v => v === '' || (S(v) && /^[\w.-]+\/[\w.-]+$/.test(v)), hint: 'owner/name' },
  branchBudget: { check: v => Number.isInteger(v) && v >= 1000 },
  pace: { check: v => ['run', 'requests', 'tools', 'both'].includes(v) },
  base: { check: v => v && typeof v === 'object' && Object.values(v).every(x => S(x) && (x === '' || /^https?:\/\//.test(x))), hint: '{provider: url}' },
  machine: { check: v => typeof v === 'boolean', hint: 'true/false; reloads the page' },
};
const SECRET = /token|key|pem|secret|passw|credential|auth|bearer/i;
const POLICY_FIELDS = ['name', 'tool', 'pattern', 'flags', 'rule', 'on'];

// -> {changes: [{path, from, to}], refused: [{path, why}], next: {settings, policies, machine}}
export function plan(text, current) {
  let j;
  try { j = JSON.parse(String(text).trim()); } catch (e) { return { error: 'Not JSON: ' + e.message }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: 'Expected a JSON object.' };
  const src = j.settings && typeof j.settings === 'object' ? j.settings : Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'policies' && k !== 'webharness' && k !== 'v'));
  const changes = [], refused = [], settings = {}, ctx = { providers: current.providers };
  let machine = null;
  for (const [k, v] of Object.entries(src)) {
    if (SECRET.test(k)) { refused.push({ path: k, why: 'looks like a credential; enter those by hand' }); continue; }
    const f = FIELDS[k];
    if (!f) { refused.push({ path: k, why: 'not a configurable field' }); continue; }
    if (!f.check(v, ctx)) { refused.push({ path: k, why: 'invalid value' + (f.hint ? ' (' + f.hint + ')' : '') }); continue; }
    if (k === 'machine') { if (v !== current.machine) { machine = v; changes.push({ path: k, from: current.machine, to: v }); } continue; }
    if (k === 'base') {
      for (const [p, url] of Object.entries(v)) {
        if (!current.providers.includes(p)) { refused.push({ path: 'base.' + p, why: 'unknown provider' }); continue; }
        if ((current.settings.base?.[p] || '') !== url) { (settings.base ??= { ...(current.settings.base || {}) })[p] = url; changes.push({ path: 'base.' + p, from: current.settings.base?.[p] || '', to: url }); }
      }
      continue;
    }
    if (current.settings[k] !== v) { settings[k] = v; changes.push({ path: k, from: current.settings[k] ?? '', to: v }); }
  }
  let policies = null;
  if (j.policies != null) {
    if (!Array.isArray(j.policies)) refused.push({ path: 'policies', why: 'must be a list' });
    else {
      policies = current.policies.map(p => ({ ...p }));
      for (const [i, p] of j.policies.entries()) {
        if (!p || !S(p.name) || !p.name.trim()) { refused.push({ path: `policies[${i}]`, why: 'needs a name' }); continue; }
        const at = policies.findIndex(x => x.name === p.name);
        if (p.remove === true) { if (at >= 0) { policies.splice(at, 1); changes.push({ path: `policy ${p.name}`, from: 'present', to: 'removed' }); } continue; }
        const given = Object.fromEntries(POLICY_FIELDS.filter(f => f in p).map(f => [f, p[f]]));
        const bad = Object.keys(p).filter(f => !POLICY_FIELDS.includes(f) && f !== 'remove');
        if (bad.length) refused.push({ path: `policy ${p.name}`, why: 'ignored fields: ' + bad.join(', ') });
        if (given.pattern != null) { try { new RegExp(given.pattern, given.flags ?? (at >= 0 ? policies[at].flags : '')); } catch (e) { refused.push({ path: `policy ${p.name}`, why: 'bad pattern: ' + e.message }); continue; } }
        if (at >= 0) {
          for (const [f, v] of Object.entries(given)) if (policies[at][f] !== v) { changes.push({ path: `policy ${p.name}.${f}`, from: policies[at][f] ?? '', to: v }); policies[at][f] = v; }
        } else {
          if (!given.pattern || !given.rule) { refused.push({ path: `policy ${p.name}`, why: 'a new policy needs pattern and rule' }); continue; }
          policies.push({ tool: '*', flags: '', on: true, ...given });
          changes.push({ path: `policy ${p.name}`, from: '(none)', to: 'added' });
        }
      }
    }
  }
  return { changes, refused, next: { settings, policies, machine } };
}

// The current non-secret configuration, in the same shape plan() reads.
export function snapshot(current) {
  const settings = {};
  for (const k of Object.keys(FIELDS)) {
    if (k === 'machine') settings.machine = current.machine;
    else if (current.settings[k] != null && current.settings[k] !== '') settings[k] = current.settings[k];
  }
  return { webharness: 'config', v: 1, settings, policies: current.policies.map(p => Object.fromEntries(POLICY_FIELDS.filter(f => p[f] != null).map(f => [f, p[f]]))) };
}
