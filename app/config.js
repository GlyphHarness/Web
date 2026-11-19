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
  logTranscripts: { check: v => typeof v === 'boolean' },
  machineUser: { check: v => v === 'session' || v === 'root', hint: 'session (a unix user per session) or root' },
  machineAuth: { check: v => v === 'inject' || v === 'env', hint: 'inject (the page adds the credential; none in the machine) or env (GH_TOKEN for the session\'s user)' },
  machineQuota: { check: v => Number.isInteger(v) && v >= 0, hint: 'MB per session home; 0 = none' },
  newProfile: { check: v => typeof v === 'string', hint: 'a profile name' },
};
const SECRET = /token|key|pem|secret|passw|credential|auth|bearer/i;
const POLICY_FIELDS = ['name', 'tool', 'pattern', 'flags', 'rule', 'on'];

// -> {changes: [{path, from, to}], refused: [{path, why}], next: {settings, policies, machine}}
export function plan(text, current) {
  let j;
  try { j = JSON.parse(String(text).trim()); } catch (e) { return { error: 'Not JSON: ' + e.message }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: 'Expected a JSON object.' };
  const src = j.settings && typeof j.settings === 'object' ? j.settings : Object.fromEntries(Object.entries(j).filter(([k]) => !['policies', 'profiles', 'webharness', 'v'].includes(k)));
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
  // profiles merge by name; parent is given by name
  let profiles = null;
  if (j.profiles != null) {
    if (!Array.isArray(j.profiles)) refused.push({ path: 'profiles', why: 'must be a list' });
    else {
      profiles = (current.profiles || []).map(p => structuredClone(p));
      const byName = n => profiles.find(p => p.name === n);
      for (const [i, p] of j.profiles.entries()) {
        if (!p || !S(p.name) || !p.name.trim()) { refused.push({ path: `profiles[${i}]`, why: 'needs a name' }); continue; }
        let t = byName(p.name);
        if (p.remove === true) { if (t) { profiles.splice(profiles.indexOf(t), 1); for (const x of profiles) if (x.parent === t.id) x.parent = t.parent; changes.push({ path: `profile ${p.name}`, from: 'present', to: 'removed' }); } continue; }
        if (!t) { t = { id: 'p' + Math.random().toString(36).slice(2, 10), name: p.name, color: S(p.color) ? p.color : '#7fb4ff', settings: {}, caps: {}, locks: [], policies: [] }; profiles.push(t); changes.push({ path: `profile ${p.name}`, from: '(none)', to: 'added' }); }
        if ('sealed' in p && typeof p.sealed === 'boolean' && !!t.sealed !== p.sealed && t.mutable !== false) { changes.push({ path: `profile ${p.name}.sealed`, from: !!t.sealed, to: p.sealed }); t.sealed = p.sealed || undefined; }
        if ('mutable' in p && typeof p.mutable === 'boolean' && (t.mutable !== false) !== p.mutable) { changes.push({ path: `profile ${p.name}.mutable`, from: t.mutable !== false, to: p.mutable }); t.mutable = p.mutable ? undefined : false; }
        if (t.mutable === false) { if (Object.keys(p).some(k => !['name', 'mutable'].includes(k))) refused.push({ path: `profile ${p.name}`, why: 'frozen: set "mutable": true first' }); continue; }
        if ('parent' in p) { const par = p.parent ? byName(p.parent) : null; if (p.parent && !par) refused.push({ path: `profile ${p.name}.parent`, why: 'no profile named ' + p.parent }); else if (par && par.id === t.id) refused.push({ path: `profile ${p.name}.parent`, why: 'cannot be its own parent' }); else if ((t.parent || null) !== (par?.id || null)) { changes.push({ path: `profile ${p.name}.parent`, from: profiles.find(x => x.id === t.parent)?.name || '', to: p.parent || '' }); t.parent = par?.id; } }
        for (const [k, v] of Object.entries(p.settings || {})) { if (SECRET.test(k) || !['model', 'helper', 'policyModel', 'pace', 'branchBudget', 'logRepo', 'logTranscripts'].includes(k)) { refused.push({ path: `profile ${p.name}.settings.${k}`, why: 'not a profile setting' }); continue; } if (t.settings[k] !== v) { changes.push({ path: `profile ${p.name}.settings.${k}`, from: t.settings[k] ?? '', to: v }); t.settings[k] = v; } }
        for (const [k, v] of Object.entries(p.caps || {})) { const ok = k === 'repo' ? ['none', 'read', 'write'].includes(v) : ['run_js', 'fanout', 'ask', 'vm'].includes(k) && typeof v === 'boolean'; if (!ok) { refused.push({ path: `profile ${p.name}.caps.${k}`, why: 'invalid capability' }); continue; } if (t.caps[k] !== v) { changes.push({ path: `profile ${p.name}.caps.${k}`, from: t.caps[k] ?? 'inherit', to: v }); t.caps[k] = v; } }
        if (Array.isArray(p.repos)) { const bad = p.repos.filter(r => !/^[\w.-]+\/[\w.*-]+$/.test(r)); if (bad.length) refused.push({ path: `profile ${p.name}.repos`, why: 'bad entries: ' + bad.join(', ') }); else { changes.push({ path: `profile ${p.name}.repos`, from: (t.repos || []).join(', '), to: p.repos.join(', ') }); t.repos = p.repos; } }
        if (Array.isArray(p.locks)) { changes.push({ path: `profile ${p.name}.locks`, from: (t.locks || []).join(', '), to: p.locks.join(', ') }); t.locks = p.locks.filter(k => ['model', 'helper', 'policyModel', 'pace', 'branchBudget', 'logRepo', 'logTranscripts'].includes(k)); }
        if (S(p.color) && p.color !== t.color) t.color = p.color;
      }
    }
  }
  // scoped values merge by label within their scope: a known label gets a new
  // revision, a new one is created. scope: "defaults" | "profile:<name>" | "session"
  let values = null;
  if (j.values != null) {
    if (!Array.isArray(j.values)) refused.push({ path: 'values', why: 'must be a list' });
    else {
      values = [];
      const pnames = new Set([...(current.profiles || []).map(p => p.name), ...(profiles || []).map(p => p.name)]);
      for (const [i, v] of j.values.entries()) {
        const path = `value ${v?.label || '#' + (i + 1)}`;
        if (!v || !S(v.label) || !v.label.trim() || v.value === undefined) { refused.push({ path, why: 'needs label and value' }); continue; }
        if (SECRET.test(v.label) || (S(v.value) && /^(ghp_|gho_|ghs_|github_pat_|sk-)[\w-]{8,}/.test(v.value))) { refused.push({ path, why: 'looks like a credential' }); continue; }
        const scope = v.scope || 'defaults';
        if (!(scope === 'defaults' || scope === 'session' || (scope.startsWith('profile:') && pnames.has(scope.slice(8))))) { refused.push({ path, why: 'scope is defaults, session or profile:<an existing name>' }); continue; }
        if (v.expose && !['value', 'purpose', 'hidden'].includes(v.expose)) { refused.push({ path, why: 'expose is value, purpose or hidden' }); continue; }
        const hit = (current.values || []).find(x => x.scope === scope && x.label.toLowerCase() === v.label.trim().toLowerCase());
        if (hit && JSON.stringify(hit.value) === JSON.stringify(v.value) && (!v.purpose || hit.purpose === v.purpose)) continue;
        values.push({ id: hit?.id || null, scope, label: v.label.trim().slice(0, 60), role: S(v.role) ? v.role : 'config', value: v.value, purpose: S(v.purpose) ? v.purpose : '', expose: v.expose, notes: S(v.notes) ? v.notes : undefined });
        changes.push({ path: `${path} (${scope})`, from: hit ? hit.value : '(none)', to: v.value });
      }
    }
  }
  if (settings.newProfile != null) {
    const ok = [...(current.profiles || []), ...(profiles || [])].some(p => p.name === settings.newProfile);
    if (!ok) { refused.push({ path: 'newProfile', why: 'no profile named ' + settings.newProfile }); changes.splice(changes.findIndex(x => x.path === 'newProfile'), 1); delete settings.newProfile; }
  }
  return { changes, refused, next: { settings, policies, machine, profiles, values } };
}

// The current non-secret configuration, in the same shape plan() reads.
export function snapshot(current) {
  const settings = {};
  for (const k of Object.keys(FIELDS)) {
    if (k === 'machine') settings.machine = current.machine;
    else if (current.settings[k] != null && current.settings[k] !== '') settings[k] = current.settings[k];
  }
  const name = id => (current.profiles || []).find(p => p.id === id)?.name;
  return { webharness: 'config', v: 1, settings, policies: current.policies.map(p => Object.fromEntries(POLICY_FIELDS.filter(f => p[f] != null).map(f => [f, p[f]]))),
    values: (current.values || []).map(v => ({ label: v.label, value: v.value, scope: v.scope, ...(v.purpose ? { purpose: v.purpose } : {}) })),
    profiles: (current.profiles || []).map(p => p.sealed ? { name: p.name, sealed: true } : ({ name: p.name, ...(p.mutable === false ? { mutable: false } : {}), ...(p.parent ? { parent: name(p.parent) } : {}), color: p.color, settings: p.settings, caps: p.caps, ...(p.repos ? { repos: p.repos } : {}), locks: p.locks })) };
}

// ---- import: loose "label: value" lines matched to what exists ----
// Lines: "label: value", "label = value", "label<TAB>value", "- label: value", or
// markdown table rows (first cell label, second cell value; header and separator
// rows skipped). Each line goes to a setting (by name or alias), else to an
// existing scoped value with that label (a new revision), else a new value.

export const ALIASES = {
  model: ['model', 'main', 'main model', 'chat model', 'session model'],
  helper: ['helper', 'helper model', 'filter model', 'side model'],
  policyModel: ['policy model', 'policymodel', 'repair model', 'review model', 'policy', 'policy and review'],
  pace: ['pace'],
  branchBudget: ['branch budget', 'budget', 'branchbudget', 'token budget'],
  logRepo: ['log repo', 'logrepo', 'log repository', 'audit repo', 'logs repo'],
  ghlabel: ['github access', 'access label', 'ghlabel', 'github label', 'token label'],
  provider: ['provider'],
};
// settings a session's scope can hold; the others exist only as defaults
export const SCOPED = ['model', 'helper', 'policyModel', 'pace', 'branchBudget', 'logRepo'];
const LOOKS_SECRET = /^(ghp_|gho_|ghs_|github_pat_|sk-|xox[abp]-|AKIA)[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY/;
const norm = t => String(t).toLowerCase().replace(/[`*_]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function lines(text) {
  const out = [];
  const raw = String(text).split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i].trim();
    if (!l || /^#/.test(l)) continue;
    let label, value;
    if (/^\|.*\|$/.test(l)) {
      if (/^\|[\s:|-]+\|$/.test(l)) continue; // separator row
      if (/^\|[\s:|-]+\|$/.test((raw[i + 1] || '').trim())) continue; // header row (followed by a separator)
      const cells = l.slice(1, -1).split('|').map(c => c.trim());
      [label, value] = cells;
    } else {
      l = l.replace(/^[-*]\s+/, '');
      const m = /^([^:=\t]{1,60}?)\s*(?::|=|\t)\s*(.*)$/.exec(l);
      if (!m) continue;
      [, label, value] = m;
    }
    value = String(value ?? '').trim().replace(/^`+|`+$/g, '').replace(/^"(.*)"$/, '$1');
    label = String(label ?? '').trim().replace(/^`+|`+$/g, '').replace(/\*\*/g, '');
    if (label && value !== '') out.push({ line: i + 1, label, value });
  }
  return out;
}

// ctx = {settings, values: [{id, label, value}], scoped: bool (a level other than defaults was chosen)}
export function planImport(text, ctx) {
  const rows = [];
  for (const x of lines(text)) {
    const n = norm(x.label);
    if (/token|secret|password|passwd|api key|apikey|private key|\bpem\b|credential/.test(n) || LOOKS_SECRET.test(x.value)) { rows.push({ ...x, action: 'refused', why: 'looks like a credential; type those into their own field' }); continue; }
    const key = Object.entries(ALIASES).find(([, al]) => al.includes(n))?.[0];
    if (key) {
      let v = x.value;
      if (key === 'branchBudget') { v = Number(String(v).replace(/[,_\s]/g, '')); if (!Number.isInteger(v) || v < 1000) { rows.push({ ...x, action: 'refused', why: 'budget must be a whole number of tokens' }); continue; } }
      if (key === 'pace' && !['run', 'requests', 'tools', 'both'].includes(v)) { rows.push({ ...x, action: 'refused', why: 'pace is run, requests, tools or both' }); continue; }
      if (key === 'logRepo' && !/^[\w.-]+\/[\w.-]+$/.test(v)) { rows.push({ ...x, action: 'refused', why: 'log repo is owner/name' }); continue; }
      if (key === 'provider' && !(ctx.providers || []).includes(v)) { rows.push({ ...x, action: 'refused', why: 'unknown provider' }); continue; }
      const scoped = SCOPED.includes(key);
      const now = scoped ? ctx.current?.(key) : ctx.settings[key];
      rows.push({ ...x, target: { kind: 'setting', key, level: scoped ? 'chosen' : 'default' }, value: v, from: now ?? '', action: String(now ?? '') === String(v) ? 'unchanged' : 'update' });
      continue;
    }
    const hit = (ctx.values || []).find(v => norm(v.label) === n);
    if (hit) rows.push({ ...x, target: { kind: 'value', id: hit.id }, from: hit.value, action: String(hit.value) === x.value ? 'unchanged' : 'update' });
    else rows.push({ ...x, target: { kind: 'value', id: null }, from: '', action: 'create' });
  }
  return rows;
}
