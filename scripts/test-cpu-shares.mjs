// CPU shares -> nice level (app/vm.js niceFor) and the setting's validation (app/config.js).
globalThis.location ??= { href: 'http://localhost/' }; // vm.js builds its asset URLs at import
const { niceFor } = await import('../app/vm.js');
import * as config from '../app/config.js';
let bad = 0;
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(got))); if (!ok) bad++; };
check('1024 and above, or unset, adds nothing', [1024, 2048, undefined, null, 0, -5, 'x'].every(s => niceFor(s) === 0), [1024, 2048, undefined, null, 0, -5, 'x'].map(niceFor));
check('512 is nice 3 (half a share, each step a factor 1.25)', niceFor(512) === 3, niceFor(512));
check('128 is nice 9', niceFor(128) === 9, niceFor(128));
check('the floor is nice 19', niceFor(2) === 19 && niceFor(1) === 19, [niceFor(2), niceFor(1)]);
check('lower shares never give a lower nice', (() => { let p = 0; for (let s = 1024; s >= 2; s--) { const n = niceFor(s); if (n < p) return false; p = n; } return true; })());
const plan = v => config.plan(JSON.stringify({ settings: { machineCpu: v } }), { settings: {}, policies: [], profiles: [], providers: ['openrouter'], values: [] });
check('paste config accepts 256', plan(256).changes.length === 1 && !plan(256).refused.length, plan(256));
check('paste config refuses 0, 1, 2000 and text', [0, 1, 2000, 'a lot', 1.5].every(v => plan(v).refused.length === 1), [0, 1, 2000, 'a lot', 1.5].map(v => plan(v).refused.length));
process.exit(bad ? 1 : 0);
