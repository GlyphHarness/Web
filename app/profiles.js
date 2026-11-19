// Profiles: scoped configuration for sessions, in a hierarchy. Access is decided by
// configuration level, not by user: a session belongs to a profile, a profile may
// have a parent, and what a session can use is resolved down that chain.
//
// profile = {id, name, parent, color,
//   settings: {model, helper, policyModel, pace, branchBudget, logRepo, logTranscripts,
//              machineUser: 'session'|'root', machineQuota: MB, machineCpu: shares, machineGh: 'inject'|'env'}   (absent = inherit)
//   caps: {run_js, fanout, ask, vm: bool, repo: 'none'|'read'|'write'}   (absent = inherit)
//   repos: ['owner/*', 'owner/name']   (absent or empty = inherit)
//   policies: [{name, tool, pattern, flags, rule, on}]   (added to the inherited ones)
//   locks: ['model', ...]}   settings no profile or session below may override
//
// Rules: settings are overridden going down unless an ancestor locked them;
// capabilities only narrow (a child never grants what its parent withholds);
// a repo must be allowed by every profile in the chain that lists repos;
// policies accumulate, and a lower profile cannot replace an ancestor's policy.

export const SETTING_KEYS = ['model', 'helper', 'policyModel', 'pace', 'branchBudget', 'logRepo', 'logTranscripts', 'machineUser', 'machineQuota', 'machineCpu', 'machineGh', 'strategy', 'watchModel'];
// Who an attribute is for. harness: configuration the harness uses on the session's
// behalf; it never appears in anything the model reads. tools: shapes the model's
// tool list (the model sees the tools, not the setting).
export const AUDIENCE = { model: 'harness', helper: 'harness', policyModel: 'harness', pace: 'harness', branchBudget: 'harness', logRepo: 'harness', logTranscripts: 'harness', machineUser: 'harness', machineQuota: 'harness', machineCpu: 'harness', machineGh: 'harness', strategy: 'harness', watchModel: 'harness', run_js: 'tools', fanout: 'tools', ask: 'tools', vm: 'tools', repo: 'tools' };
export const CAP_KEYS = ['run_js', 'fanout', 'ask', 'vm', 'repo'];
const REPO_RANK = { none: 0, read: 1, write: 2 };
const ALL = { run_js: true, fanout: true, ask: true, vm: true, repo: 'write' };

export function chain(profiles, id) {
  const out = [], seen = new Set();
  for (let p = profiles.find(x => x.id === id); p && !seen.has(p.id); p = profiles.find(x => x.id === p.parent)) { seen.add(p.id); out.unshift(p); }
  return out; // root first
}

export const descendants = (profiles, id) => profiles.filter(p => p.id !== id && chain(profiles, p.id).some(a => a.id === id));
// what a session in profile `id` may be moved to (itself or below); no profile = anything
export const assignable = (profiles, id) => id ? [profiles.find(p => p.id === id), ...descendants(profiles, id)].filter(Boolean) : profiles;

const globMatch = (pat, repo) => new RegExp('^' + pat.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$', 'i').test(repo);

// global = the Settings values; over = the session's own overrides
export function effective(profiles, id, global, over = {}) {
  const c = chain(profiles, id);
  const settings = { ...global }, from = {}, locked = new Map();
  let caps = { ...ALL };
  const repoLists = [], policies = [];
  for (const p of c) {
    for (const k of SETTING_KEYS) {
      const v = p.settings?.[k];
      if (v == null || v === '') continue;
      if (locked.has(k)) continue;
      settings[k] = v; from[k] = p.name;
    }
    for (const k of p.locks || []) if (!locked.has(k)) locked.set(k, p.name);
    for (const k of CAP_KEYS) {
      const v = p.caps?.[k];
      if (v == null) continue;
      caps[k] = k === 'repo' ? (REPO_RANK[v] < REPO_RANK[caps.repo] ? v : caps.repo) : caps[k] && !!v;
    }
    if (p.repos?.length) repoLists.push({ name: p.name, list: p.repos });
    for (const pol of p.policies || []) if (!policies.some(x => x.name === pol.name)) policies.push({ ...pol, from: p.name });
  }
  for (const [k, v] of Object.entries(over || {})) if (SETTING_KEYS.includes(k) && v != null && v !== '' && !locked.has(k)) { settings[k] = v; from[k] = 'this session'; }
  // a session may narrow its own capabilities, never widen them
  const capFrom = {};
  for (const p of c) for (const k of CAP_KEYS) if (p.caps?.[k] != null) capFrom[k] = p.name;
  for (const [k, v] of Object.entries(over?.caps || {})) {
    if (!CAP_KEYS.includes(k) || v == null) continue;
    const before = caps[k];
    caps[k] = k === 'repo' ? (REPO_RANK[v] < REPO_RANK[caps.repo] ? v : caps.repo) : caps[k] && !!v;
    if (caps[k] !== before) capFrom[k] = 'this session';
  }
  const repoAllowed = repo => repoLists.every(r => r.list.some(pat => globMatch(pat, repo)));
  // sealed: the session's directives stay inside its execution (not exported, synced or bridged)
  const sealed = c.some(p => p.sealed);
  return { chain: c, settings, from, locked, caps, capFrom, repoLists, repoAllowed, policies, sealed, path: c.map(p => p.name).join(' / ') };
}

// Tools a session may have, from its tool groups and the resolved capabilities.
export function allowedTool(name, caps) {
  if (name === 'run_js') return caps.run_js;
  if (name === 'fan_out' || name === 'branch_read') return caps.fanout;
  if (name === 'ask' || /^value_/.test(name)) return caps.ask;
  if (name === 'shell') return caps.vm;
  if (name === 'repo_read') return REPO_RANK[caps.repo] >= 1;
  if (/^repo_/.test(name)) return REPO_RANK[caps.repo] >= 2;
  return true;
}

export const PALETTE = ['#7fb4ff', '#6fd08c', '#e0a040', '#d38cff', '#ff8a80', '#4dd0c8', '#c0ca33'];
