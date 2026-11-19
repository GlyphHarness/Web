// Credential import: the "keys" block of Paste config and the key lines of Import.
// Node only; no browser. Checks the plan: masked everywhere, never in settings.
import * as config from '../app/config.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail)); if (!ok) fails++; };

const OR = 'sk-or-v1-' + 'a1b2c3d4'.repeat(4), GH = 'github_pat_' + 'Z9y8x7w6'.repeat(3);
const cur = { settings: { provider: 'openrouter' }, policies: [], profiles: [], providers: ['openrouter', 'openai'], machine: false, values: [], keys: {} };

let p = config.plan(JSON.stringify({ webharness: 'config', keys: { openrouter: OR, github: GH }, settings: { logRepo: 'o/log', concernRepo: 'o/concerns' } }), cur);
check('keys block: both keys go to next.keys', p.next.keys?.openrouter === OR && p.next.keys?.github === GH, JSON.stringify(p.next.keys));
check('keys block: log and concerns repo are settings', p.next.settings.logRepo === 'o/log' && p.next.settings.concernRepo === 'o/concerns', JSON.stringify(p.next.settings));
check('keys block: nothing credential-like lands in settings', !JSON.stringify(p.next.settings).includes(OR) && !JSON.stringify(p.next.settings).includes(GH));
const shown = JSON.stringify(p.changes);
check('keys block: the plan shows them masked, never whole', !shown.includes(OR) && !shown.includes(GH) && /sk-o….*chars/.test(shown) && p.changes.filter(c => c.secret).length === 2, shown);
check('keys block: nothing refused', p.refused.length === 0, JSON.stringify(p.refused));

p = config.plan(JSON.stringify({ keys: { openrouter: OR } }), { ...cur, keys: { openrouter: OR } });
check('keys block: an unchanged key is not a change', !p.next.keys && p.changes.length === 0);

p = config.plan(JSON.stringify({ keys: { openrouter: '' } }), { ...cur, keys: { openrouter: OR } });
check('keys block: "" removes a key', p.next.keys?.openrouter === '' && p.changes[0].to === '(removed)' && !JSON.stringify(p.changes).includes(OR));

p = config.plan(JSON.stringify({ keys: { nonesuch: OR, github: 'short', openai: 'has space in it' } }), cur);
check('keys block: unknown id, short and spaced values are refused', p.refused.length === 3 && !p.next.keys, JSON.stringify(p.refused));
check('keys block: a refusal never repeats the value', !JSON.stringify(p.refused).includes('has space'));

p = config.plan(JSON.stringify({ settings: { apiKey: OR, githubToken: GH, model: 'm/x' } }), cur);
check('a credential field in settings is still refused, and points to the keys block', p.refused.length === 2 && /keys/.test(p.refused[0].why) && p.next.settings.model === 'm/x' && !p.next.keys);

p = config.plan(JSON.stringify({ values: [{ label: 'note', value: GH }] }), cur);
check('a credential as a value is still refused', p.refused.length === 1 && p.refused[0].path === 'value note' && !p.next.values?.length);

p = config.plan(JSON.stringify({ settings: { concernRepo: 'not a repo' } }), cur);
check('concernRepo must be owner/name', p.refused.length === 1);

const snap = JSON.stringify(config.snapshot({ ...cur, keys: { openrouter: OR, github: GH }, settings: { ...cur.settings, concernRepo: 'o/c' } }));
check('copy config carries no keys, and does carry concernRepo', !snap.includes(OR) && !snap.includes(GH) && /"concernRepo":"o\/c"/.test(snap));

// Import lines
const ctx = { settings: cur.settings, keys: {}, providers: cur.providers, values: [], current: () => undefined };
const rows = config.planImport(`openrouter key: ${OR}\ngithub token: ${GH}\nconcerns repo: o/concerns\nlog repo: o/log\napi key: ${OR}\nclient secret: abcdefghijkl`, ctx);
const by = l => rows.find(r => r.label === l);
check('import: "openrouter key" and "github token" go to the key store', by('openrouter key')?.target?.id === 'openrouter' && by('github token')?.target?.id === 'github' && by('github token').secret === GH);
check('import: "api key" is the current provider\'s', by('api key')?.target?.id === 'openrouter');
check('import: the shown value is masked', rows.filter(r => r.target?.kind === 'key').every(r => !String(r.value).includes('c3d4c3d4') && /chars/.test(r.value)), JSON.stringify(rows.map(r => r.value)));
check('import: concerns repo and log repo are settings', by('concerns repo')?.target?.key === 'concernRepo' && by('log repo')?.target?.key === 'logRepo');
check('import: other secrets are still refused', by('client secret')?.action === 'refused');
const again = config.planImport(`github token: ${GH}`, { ...ctx, keys: { github: GH } });
check('import: the same key is unchanged', again[0].action === 'unchanged');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
