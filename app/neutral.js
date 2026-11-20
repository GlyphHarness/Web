// Identifying terms: words that would tell a model what runs it. Nothing the harness gives a
// model (the core prompt, tool definitions, tool results, injected turns, helper prompts) may
// hold one. Checked on the requests as they are built (scripts/test-localbridge.mjs, suite
// local; scripts/smoke.mjs, suite main). Text for the person is not covered: it names things.
//
// The list (docs/TESTING.md has it in words). A term is matched as a word, case ignored;
// "harness" is matched anywhere, so the product's names are covered too.
const RULES = [
  ['webharness', /webharness/i], ['glyphharness', /glyphharness/i], ['harness', /harness/i],
  ['github.io', /github\.io/i],
  ['browser', /\bbrowsers?\b/i], ['page', /\bpages?\b/i], ['tab', /\btabs?\b/i], ['this app', /\bthis app\b/i],
  ['bridge', /\bbridges?\b/i], ['wh-local', /\bwh-local\b/i],
  ['cross-origin', /\bcross-origin\b/i], ['service worker', /\bservice workers?\b/i],
];
export const TERMS = RULES.map(r => r[0]);

// the terms a text holds ([] = none)
export const found = text => { const t = String(text ?? ''); return RULES.filter(r => r[1].test(t)).map(r => r[0]); };

// A message from code that also talks to the person (the machine, the local connector) on its way to a
// model: kept when it names nothing, replaced by the plain fallback when it does.
export const neutral = (message, fallback) => { const m = String(message ?? ''); return m && !found(m).length ? m : fallback; };
