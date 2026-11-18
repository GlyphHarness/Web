// The custodial queue: housekeeping the harness does on the sessions' behalf
// (condensing, titling, steering review, credential checks, retries) is not run
// on its own. Conditions put items here; the person drains them. Each item says
// what it is, what it touches, why it was queued, what it is for, what it should
// cost, and how that cost is kept down. Identical items merge.
//
// item = {id, type, key, targets: [{kind, id, label}], reason: {kind, policy?, detail},
//         intent, estimate: {in, out, model, cost}, procedure: [..], status, created, fired, result?}

export const TYPES = {
  condense: {
    label: 'condense', model: 'helper', maxOut: 1500,
    intent: 'Shorten finished replies before they are sent back, and title new sessions, so later requests carry less.',
    procedure: ['one request for every session at once', 'at most 12 items per pass; each reply cut to 8,000 characters', 'fixed instructions (cacheable prefix)', 'helper model (the cheap one)', 'output capped at 1,500 tokens', 'nothing is applied if the request fails: replies just go out whole'],
  },
  review: {
    label: 'steering review', model: 'policy', maxOut: 600,
    intent: 'Propose changes to conventions, policies or tool wording from the smell counts; you adopt or dismiss each.',
    procedure: ['counts and steering texts only, never transcripts', 'last 200 rows, details cut to 120 characters', 'fixed instructions (cacheable prefix)', 'policy model (cheap), else the helper', 'output capped at 600 tokens; at most 5 proposals'],
  },
  'scope-check': {
    label: 'credential check', model: null, maxOut: 0,
    intent: 'Compare the GitHub credential with its intended use.',
    procedure: ['plain API calls; no model, no tokens', 'write is probed only if you allowed it'],
  },
  'log-retry': {
    label: 'retry log sync', model: null, maxOut: 0,
    intent: 'Write what the last sync could not.',
    procedure: ['plain API calls; no model, no tokens', 'append-only: nothing already written is rewritten'],
  },
};

export const keyOf = (type, targets) => type + ':' + targets.map(t => t.kind + '=' + t.id).sort().join(',');

// price = {prompt, completion} USD per token (strings or numbers, as the catalogue gives them)
export function estimate(type, inChars, model, price) {
  const T = TYPES[type];
  if (!T.model) return { in: 0, out: 0, model: null, cost: 0 };
  const tin = Math.ceil(inChars / 4), tout = T.maxOut;
  const cost = price ? tin * Number(price.prompt || 0) + tout * Number(price.completion || 0) : null;
  return { in: tin, out: tout, model, cost };
}

// add or merge; returns the item
export function enqueue(list, { type, targets, reason, inChars = 0, model = null, price = null }) {
  const key = keyOf(type, targets);
  const est = estimate(type, inChars, model, price);
  let it = list.find(x => x.key === key && x.status === 'queued');
  if (it) { it.fired++; it.reason = reason; it.estimate = est; it.last = Date.now(); return it; }
  it = { id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, key, targets, reason, intent: TYPES[type].intent, procedure: TYPES[type].procedure, estimate: est, status: 'queued', created: Date.now(), last: Date.now(), fired: 1 };
  list.push(it);
  return it;
}

export const pending = list => list.filter(x => x.status === 'queued');
export const total = list => pending(list).reduce((a, x) => ({ in: a.in + x.estimate.in, out: a.out + x.estimate.out, cost: a.cost + (x.estimate.cost || 0) }), { in: 0, out: 0, cost: 0 });
