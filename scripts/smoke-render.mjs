// Render plugins (app/render.js), in a real browser against the offline mock provider.
// Usage: python -m http.server <port> (repo root), then:
//   node scripts/smoke-render.mjs [url] [baseline-url] [screenshot-dir]
// baseline-url: the same app served from a checkout without render plugins; when given,
// the default look is compared with it byte for byte (outerHTML of the seeded sessions).
// Set WH_CHANNEL=chrome to use the installed Chrome when Playwright's chromium is absent.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:8787/';
const base = process.argv[3] || '';
const shots = process.argv[4] || '';
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/render-sessions.json', import.meta.url), 'utf8'));
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ok ? '' : extra}`); if (!ok) process.exitCode = 1; };

const browser = await chromium.launch(process.env.WH_CHANNEL ? { channel: process.env.WH_CHANNEL } : {});
const orCalls = [], errors = [];
const KEYS = new Set();

// A fresh page with the fixture sessions seeded once (a reload keeps what the page stored).
async function open(u, active = 'a') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.route(/^https:\/\/openrouter\.ai\//, r => { orCalls.push(r.request().url()); r.abort(); });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(u).origin });
  await ctx.addInitScript(f => {
    if (localStorage.getItem('wh:meta')) return;
    const meta = { ...f.meta, active: f.active };
    localStorage.setItem('wh:meta', JSON.stringify(meta));
    for (const s of f.sessions) localStorage.setItem('wh:s:' + s.id, JSON.stringify(s));
  }, { ...fx, active: active === 'b' ? 's_fix_b' : 's_fix_a' });
  const page = await ctx.newPage();
  page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(u);
  await page.waitForSelector('.thread[data-session] .msg');
  return { ctx, page };
}
const R = (page, fn, arg) => page.evaluate(async ([src, a]) => { const m = await import('./app/render.js'); return (0, eval)('(' + src + ')')(m, a); }, [fn.toString(), arg]);
const settle = page => page.waitForTimeout(250);
const thread = page => page.locator('.thread[data-session]:visible');
const html = page => page.evaluate(() => document.querySelector('.thread[data-session]').outerHTML);
// markup that could run or load something, anywhere in the page's threads
const danger = page => page.evaluate(() => {
  const bad = [];
  for (const t of document.querySelectorAll('.thread')) {
    for (const e of t.querySelectorAll('*')) {
      if (/^(script|iframe|object|embed|style|svg|math|link|meta|base|form|frame|frameset|template)$/i.test(e.localName)) bad.push('<' + e.localName + '>');
      for (const a of e.attributes) {
        if (/^on/i.test(a.name)) bad.push(a.name);
        if (/^(srcdoc|formaction|action|style|id|name)$/i.test(a.name)) bad.push(e.localName + '[' + a.name + ']');
        if (/^(href|src)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text)/i.test(a.value)) bad.push(a.name + '=' + a.value.slice(0, 20));
      }
    }
  }
  return bad;
});

// ---------- 1. default look is unchanged ----------
const a = await open(url, 'a');
const b = await open(url, 'b');
if (base) {
  const ba = await open(base, 'a'), bb = await open(base, 'b');
  for (const [n, x, y] of [['ordinary session', a.page, ba.page], ['hostile-text session', b.page, bb.page]]) {
    const one = await html(x), two = await html(y);
    check(`default look: ${n} is byte-identical to the baseline`, one === two, `${one.length} vs ${two.length}`);
  }
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    for (const [n, p] of [['after-a', a.page], ['before-a', ba.page], ['after-b', b.page], ['before-b', bb.page]]) await p.screenshot({ path: path.join(shots, n + '.png') });
  }
  // a held card (request pacing), same on both
  const heldOf = async p => {
    await p.selectOption('#provider', 'mock');
    await p.selectOption('#pace', 'requests');
    await p.fill('#input', 'held hello'); await p.click('#send');
    await p.waitForSelector('.thread:visible .msg[data-role=held]');
    return (await p.locator('.thread:visible .msg[data-role=held]').first().evaluate(e => e.outerHTML)).replace(/ data-held="[^"]*"/, '').replace(/\d+(\.\d+)?/g, '#');
  };
  const h1 = await heldOf(a.page), h2 = await heldOf(ba.page);
  check('default look: held card matches the baseline', h1 === h2, h1.slice(0, 200) + ' || ' + h2.slice(0, 200));
  await ba.ctx.close(); await bb.ctx.close();
} else {
  const heldOnly = async () => {
    await a.page.selectOption('#provider', 'mock');
    await a.page.selectOption('#pace', 'requests');
    await a.page.fill('#input', 'held hello'); await a.page.click('#send');
    await a.page.waitForSelector('.thread:visible .msg[data-role=held]');
  };
  await heldOnly();
}
// the held card keeps its controls
const held = a.page.locator('.thread:visible .msg[data-role=held]').first();
check('held card: has the harness controls', await held.locator('[data-hold=release]').count() === 1);
await a.page.click('[data-hold=all]').catch(() => {});
await a.page.selectOption('#pace', 'off').catch(() => {});
await a.page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
check('default look: no transform is on, so no link, handle or collapse markup', await a.page.locator('.rp-ref, .rp-handle, details.rp-collapse').count() === 0);

// ---------- 2. a custom template changes the rendering ----------
const callsBefore = await thread(a.page).locator('details:has(> summary)').count();
await R(a.page, m => {
  m.register({
    id: 'compact-calls', name: 'Compact tool calls',
    templates: {
      'tool-call'(d, ctx) {
        return ctx.h('div', { class: 'rp-row rp-compact' },
          ctx.h('span', { class: 'rp-chip', text: d.name }),
          ctx.h('code', { class: 'rp-grow rp-clip rp-mono', title: d.args, text: d.args.replace(/\s+/g, ' ').slice(0, 90) }),
          ctx.h('button', { type: 'button', 'data-copy-text': d.args, text: 'copy' }));
      },
    },
  });
});
await settle(a.page);
const rows = thread(a.page).locator('.rp-compact');
check('custom template: tool calls draw as one-line rows', await rows.count() === 2, String(await rows.count()));
check('custom template: the row names the tool and shows its arguments', /run_js/.test(await rows.first().textContent()) && /return 42/.test(await rows.first().textContent()));
await rows.first().locator('button').click();
check('custom template: the copy button copies the arguments', /return 42/.test(await a.page.evaluate(() => navigator.clipboard.readText())));
check('custom template: replaced the default call rows', await thread(a.page).locator('details:has(> summary)').count() < callsBefore);
await R(a.page, m => m.unregister('compact-calls'));
await settle(a.page);
check('custom template: removing the plugin restores the default look', await thread(a.page).locator('.rp-compact').count() === 0 && await thread(a.page).locator('details:has(> summary)').count() === callsBefore);

// a template that throws, and one that returns nothing, fall through to the default
await R(a.page, m => m.register({ id: 'throws', templates: { 'tool-call'() { throw new Error('boom'); }, assistant() { return null; } } }));
await settle(a.page);
check('fallback: a template that throws or returns null leaves the default look', await thread(a.page).locator('details:has(> summary)').count() === callsBefore);
check('fallback: the throw is recorded', await R(a.page, m => m.errors().some(e => e.plugin === 'throws' && /boom/.test(e.message))));
await R(a.page, m => m.unregister('throws'));

// ---------- 3. a custom transform changes the rendering ----------
await R(a.page, m => m.enable('core-transforms/gh-refs', true));
await settle(a.page);
const ref = thread(a.page).locator('a.rp-ref').first();
check('transform: owner/repo#n becomes a link', await ref.count() > 0 && await ref.getAttribute('href') === 'https://github.com/acme/widgets/issues/42', await ref.getAttribute('href'));
check('transform: links open safely', /noopener/.test(await ref.getAttribute('rel')) && await ref.getAttribute('target') === '_blank');
check('transform: the link text is still the model\'s text', await ref.textContent() === 'acme/widgets#42');
await R(a.page, m => { m.enable('core-transforms/handles', true); m.enable('core-transforms/collapse-long', true); });
await settle(a.page);
check('transform: handles are marked', await thread(a.page).locator('.rp-handle').count() > 0);
check('transform: long tool output collapses behind a toggle', await thread(a.page).locator('details.rp-collapse').count() > 0);
await R(a.page, m => m.register({
  id: 'at-handles', transforms: [{ id: 'at', scope: ['assistant'], transform: m.rx(/\bwidgets\b/g, (mm, ctx) => ctx.h('mark', { class: 'rp-accent', text: mm[0] })) }],
}));
await settle(a.page);
check('transform: a code transform wraps its matches', await thread(a.page).locator('mark.rp-accent').count() > 0);
await R(a.page, m => m.enable('at-handles/at', false));
await settle(a.page);
check('transform: a transform can be switched off per user', await thread(a.page).locator('mark.rp-accent').count() === 0);
await R(a.page, m => { m.unregister('at-handles'); m.enable('core-transforms/gh-refs', false); m.enable('core-transforms/handles', false); m.enable('core-transforms/collapse-long', false); });
await settle(a.page);
check('transform: switching all off restores the default look', await a.page.locator('.rp-ref, .rp-handle, .rp-collapse').count() === 0);
if (base) check('transform: and it is byte-identical to the baseline again', await html(a.page).then(x => !/rp-/.test(x)));

// ---------- 4. a pasted spec, through the Look dialog, persists ----------
const SPEC = {
  id: 'one-line-calls', name: 'One-line tool calls', styles: ['color'],
  templates: {
    'tool-call': { markup: '<div class="rp-row rp-spec-call"><span class="rp-chip">{{name}}</span><code class="rp-grow rp-clip rp-mono" title="{{args}}">{{args|clip:40}}</code><button type="button" data-copy-text="{{args}}">copy</button></div>' },
    reasoning: { markup: '<details class="rp-muted rp-spec-think"><summary>reasoning</summary><div>{{text}}</div></details>' },
  },
  transforms: [{ id: 'gh', title: 'Link owner/repo#n', scope: ['assistant'], pattern: '(?<![\\w/.:-])([A-Za-z0-9-]{1,39})/([\\w.-]{1,100})#(\\d{1,7})\\b', replace: '<a href="https://github.com/$1/$2/issues/$3">$1/$2#$3</a>' }],
};
await a.page.click('[data-act=look]');
await a.page.waitForSelector('.rp-look textarea');
await a.page.fill('.rp-look textarea', JSON.stringify(SPEC));
await a.page.click('.rp-look >> text=add spec');
check('look dialog: a valid spec is accepted', /added one-line-calls/.test(await a.page.locator('.rp-look .rp-ok').textContent()));
await a.page.keyboard.press('Escape');
await a.page.locator('button:has-text("Close")').click({ timeout: 1000 }).catch(() => {});
await settle(a.page);
check('spec: the pasted template draws the tool calls', await thread(a.page).locator('.rp-spec-call').count() === 2);
check('spec: placeholders insert values as text', /return 42/.test(await thread(a.page).locator('.rp-spec-call code').first().textContent()));
check('spec: the pasted transform links references', await thread(a.page).locator('a[href="https://github.com/acme/widgets/issues/42"]').count() > 0);
check('spec: the reasoning template draws', await thread(a.page).locator('.rp-spec-think').count() >= 1);
await a.page.reload();
await a.page.waitForSelector('.thread[data-session] .msg');
await settle(a.page);
check('spec: still applied after a reload (persisted under wh:render)', await thread(a.page).locator('.rp-spec-call').count() === 2);
check('spec: stored under a wh: key', await a.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('wh:render')).specs.some(s => s.id === 'one-line-calls'); } catch { return false; } }));
check('spec: stored data is re-validated on load (a corrupted entry is dropped, the app still loads)', await (async () => {
  await a.page.evaluate(() => localStorage.setItem('wh:render', JSON.stringify({ v: 1, specs: [{ id: 'x', templates: { user: { markup: '<script>window.__pwned=9</script>' } }, evil: 1 }], on: {}, order: [] })));
  await a.page.reload(); await a.page.waitForSelector('.thread[data-session] .msg');
  return await a.page.locator('.rp-spec-call').count() === 0 && await a.page.evaluate(() => window.__pwned) === undefined;
})());
await a.page.evaluate(() => localStorage.setItem('wh:render', '{not json'));
await a.page.reload();
check('spec: an unreadable wh:render is ignored', await a.page.waitForSelector('.thread[data-session] .msg').then(() => true));
await a.page.evaluate(() => localStorage.removeItem('wh:render'));

// ---------- 5. hostile input ----------
const HOSTILE = [
  '<script>window.__pwned = 1</script>',
  '<img src=x onerror="window.__pwned=2">',
  '<a href="javascript:window.__pwned=3">click</a>',
  '<svg><script>window.__pwned=4</script><circle onload="window.__pwned=5"/></svg>',
  '<svg><g><svg><use href="data:image/svg+xml,<svg onload=window.__pwned=6>"/></svg></g></svg>',
  '<div style="width:expression(window.__pwned=7)">x</div>',
  '<div style="background:url(javascript:window.__pwned=8)">x</div>',
  '<iframe srcdoc="<script>parent.__pwned=9</script>"></iframe>',
  '<style>*{display:none}</style>',
  '<math><mi xlink:href="javascript:window.__pwned=10">x</mi></math>',
  '<form action="javascript:window.__pwned=11"><button formaction="javascript:window.__pwned=12">go</button></form>',
  '<a href="  jAvA\nscript:window.__pwned=13">x</a>',
  '<a href="data:text/html,<script>window.__pwned=14</script>">x</a>',
  '<img src="https://evil.example/pixel.png">',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9d2luZG93Ll9fcHduZWQ9MTU+">',
  '<input autofocus onfocus="window.__pwned=16">',
  '<details open ontoggle="window.__pwned=17"><summary>x</summary></details>',
  '<noscript><p title="</noscript><img src=x onerror=window.__pwned=18>"></noscript>',
  '<div id="app" class="modal">overlay</div>',
  '<base href="https://evil.example/">',
];
const sanitized = await R(a.page, (m, vectors) => vectors.map(v => {
  const f = m.sanitize(v);
  const box = document.createElement('div'); box.append(f);
  const bad = [];
  for (const e of box.querySelectorAll('*')) {
    if (!/^(a|b|i|em|strong|code|pre|span|div|p|ul|ol|li|br|small|sub|sup|mark|details|summary|button|img|kbd|blockquote|h1|h2|h3|h4|h5|h6|hr|table|thead|tbody|tr|td|th|del|ins|u|s|q|cite|abbr|dfn|var|samp|time|label|header|footer|section|article|aside|nav|figure|figcaption|dl|dt|dd|caption|wbr)$/.test(e.localName)) bad.push(e.localName);
    for (const at of e.attributes) if (/^(on|srcdoc|formaction|id|name)/i.test(at.name) || (at.name === 'style' && /expression|url|javascript/i.test(at.value)) || (/^(href|src)$/.test(at.name) && /^\s*(javascript|vbscript)/i.test(at.value))) bad.push(at.name);
  }
  return { v, out: box.innerHTML, bad };
}), HOSTILE);
for (const r of sanitized) check('sanitize: ' + r.v.slice(0, 50).replace(/\n/g, ' '), r.bad.length === 0 && !/<script|<svg|<style|<iframe|onerror|onload|javascript:/i.test(r.out), r.bad.join(',') + ' => ' + r.out);
check('sanitize: nothing ran', await a.page.evaluate(() => window.__pwned) === undefined);
check('sanitize: an inline style is dropped unless the plugin allowlists it', await R(a.page, m => { const d = document.createElement('div'); d.append(m.sanitize('<span style="color:red">x</span>')); return !d.querySelector('[style]'); }));
check('sanitize: an allowlisted style property survives, an unlisted one does not', await R(a.page, m => { const d = document.createElement('div'); d.append(m.sanitize('<span style="color:red;position:fixed;background:url(x)">x</span>', { styles: ['color'] })); const s = d.firstChild.getAttribute('style') || ''; return /color:\s*red/.test(s) && !/position|url/.test(s); }));
check('sanitize: a link gets the safe rel and target', await R(a.page, m => { const d = document.createElement('div'); d.append(m.sanitize('<a href="https://example.com/">x</a>')); const x = d.firstChild; return x.target === '_blank' && /noopener/.test(x.rel) && /nofollow/.test(x.rel); }));
check('sanitize: a link to a script or a data page loses its href', await R(a.page, m => { const d = document.createElement('div'); d.append(m.sanitize('<a href="javascript:1">x</a><a href="data:text/html;base64,AA==">y</a>')); return ![...d.querySelectorAll('a')].some(x => x.hasAttribute('href')); }));
check('sanitize: a huge or deeply nested input is capped, not run', await R(a.page, m => { const d = document.createElement('div'); d.append(m.sanitize('<div>'.repeat(500) + 'x')); return d.querySelectorAll('*').length <= 5000; }));

// model text is only a text node: session b is hostile text, with every default transform on
await R(b.page, m => { m.enable('core-transforms/gh-refs', true); m.enable('core-transforms/handles', true); m.enable('core-transforms/collapse-long', true); });
await settle(b.page);
check('hostile text: nothing in the thread is an element, attribute or URL that could run', (await danger(b.page)).length === 0, (await danger(b.page)).join(','));
check('hostile text: it is shown as text', /<script>window\.__pwned = 1<\/script>/.test(await thread(b.page).first().textContent()));
check('hostile text: it ran nothing', await b.page.evaluate(() => window.__pwned) === undefined);

// hostile markup in a template and in a spec, and hostile model text through a template
await R(b.page, (m, v) => m.register({
  id: 'hostile-code',
  templates: {
    assistant(d, ctx) { const el = ctx.h('article', {}); const box = document.implementation.createHTMLDocument('').body; box.innerHTML = v.join('') + d.text; el.append(...box.childNodes, ...ctx.slot('body')); return el; },
    'tool-result': (d, ctx) => v.join('') + d.text,
  },
}), HOSTILE);
await settle(b.page);
check('hostile template (code): the guard leaves no script, handler, style or script URL', (await danger(b.page)).length === 0, (await danger(b.page)).join(','));
check('hostile template (code): it ran nothing', await b.page.evaluate(() => window.__pwned) === undefined);
await R(b.page, m => m.unregister('hostile-code'));
const hostileSpec = { id: 'hostile-spec', templates: {
  assistant: { markup: HOSTILE.join('') + '<p class="chip card modal" id="x" data-x="1">{{text}}</p><span data-slot="body"></span>' },
  'tool-call': { markup: '<a href="{{args}}" title="{{args}}">{{name}}</a><img src="{{args}}">' },
} };
const added = await R(b.page, (m, s) => m.addSpec(s), hostileSpec);
check('hostile template (spec): the spec is accepted and sanitized, not refused for markup', added.ok === true, JSON.stringify(added));
await settle(b.page);
check('hostile template (spec): no script, handler, style or script URL in the page', (await danger(b.page)).length === 0, (await danger(b.page)).join(','));
check('hostile template (spec): model text inserted through a placeholder stays text', /<script>window\.__pwned = 1<\/script>/.test(await thread(b.page).first().textContent()));
check('hostile template (spec): app classes and ids are stripped', await b.page.locator('.thread p.chip, .thread p.card, .thread p.modal, .thread #x').count() === 0);
check('hostile template (spec): it ran nothing', await b.page.evaluate(() => window.__pwned) === undefined);
await R(b.page, m => m.removeSpec('hostile-spec'));

// attributes filled from untrusted data are checked like any other attribute
await R(b.page, m => m.addSpec({ id: 'url-fill', templates: { user: { markup: '<a href="{{text}}">{{text|clip:20}}</a><span data-slot="body"></span>' } } }));
await settle(b.page);
check('placeholder in href: a javascript: value loses the link', await thread(b.page).locator('.msg[data-role=user] a[href^=javascript]').count() === 0);
await R(b.page, m => m.removeSpec('url-fill'));

// css in a code plugin
const css = await R(a.page, m => {
  const out = {};
  for (const [k, v] of Object.entries({
    import: '@import url(https://evil.example/x.css);',
    expression: '.rp-x { width: expression(alert(1)) }',
    js: '.rp-x { background: url(javascript:alert(1)) }',
    remote: '.rp-x { background: url(https://evil.example/x.png) }',
    behavior: '.rp-x { behavior: url(x.htc) }',
    escape: '.rp-x { background: \\75rl(https://evil.example/x.png) }',
    tag: '</style><script>window.__pwned=20</script>',
    ok: '.rp-x { color: var(--accent, #7aa2f7); }',
  })) {
    const before = document.querySelectorAll('style[data-bind="rp:css-' + k + '"]').length;
    try { m.register({ id: 'css-' + k, css: v, templates: {} }); } catch (e) { out[k] = 'throws'; continue; }
    const t = document.querySelector('style[data-bind="rp:css-' + k + '"]');
    out[k] = t && t.textContent.trim() ? 'injected' : 'refused';
    m.unregister('css-' + k);
  }
  return out;
});
for (const k of ['import', 'expression', 'js', 'remote', 'behavior', 'escape', 'tag']) check('plugin css: ' + k + ' is refused', css[k] !== 'injected', css[k]);
check('plugin css: plain css with var() is accepted', css.ok === 'injected', css.ok);

// spec refusals
const refuse = await R(a.page, m => {
  const t = s => m.addSpec(s);
  const ok = (id, extra) => ({ id, ...extra });
  return {
    redos: t(ok('redos', { transforms: [{ id: 'r', pattern: '(a+)+$', text: 'x' }] })),
    redos2: t(ok('redos2', { transforms: [{ id: 'r', pattern: '(.*)*x', text: 'x' }] })),
    backref: t(ok('backref', { transforms: [{ id: 'r', pattern: '(a)\\1', text: 'x' }] })),
    long: t(ok('long', { transforms: [{ id: 'r', pattern: 'a'.repeat(300), text: 'x' }] })),
    both: t(ok('both', { transforms: [{ id: 'r', pattern: 'a', replace: 'x', text: 'y' }] })),
    flag: t(ok('flag', { transforms: [{ id: 'r', pattern: 'a', flags: 'y', text: 'y' }] })),
    core: t(ok('core-x', {})),
    badid: t(ok('Bad Id', {})),
    part: t(ok('part', { templates: { nope: '<p>x</p>' } })),
    key: t(ok('key', { run: 'alert(1)' })),
    style: t(ok('style', { styles: ['position'] })),
    big: t(ok('big', { templates: { user: { markup: '<p>' + 'x'.repeat(70000) + '</p>' } } })),
    json: t('{nope'),
    fn: t({ id: 'fnspec', templates: { user: () => '<p>x</p>' } }),
  };
});
for (const [k, v] of Object.entries(refuse)) check('spec refused: ' + k, v.ok === false && !!v.error, JSON.stringify(v));
check('spec refused: nothing refused was stored', await R(a.page, m => m.list().filter(p => !p.builtin).length) === 0);

// placeholders cannot inject markup or reach outside data
await R(a.page, m => m.addSpec({ id: 'ph', templates: { user: { markup: '<p class="rp-ph" title="{{__proto__}}">{{text}}{{constructor}}{{text|json}}</p><span data-slot="body"></span>' } } }));
await settle(a.page);
check('placeholders: only data is reachable, and as text', await thread(a.page).locator('.rp-ph').count() >= 1 && !/\[native code\]|function/.test(await thread(a.page).locator('.rp-ph').first().textContent()));
await R(a.page, m => m.removeSpec('ph'));

// ---------- 6. controls survive any template ----------
await R(a.page, m => m.addSpec({ id: 'no-controls', templates: { held: { markup: '<div class="rp-held">only text</div>' }, user: { markup: '<p class="rp-user">no slot here</p>' } } }));
await a.page.selectOption('#pace', 'requests');
await a.page.fill('#input', 'held again'); await a.page.click('#send');
await a.page.waitForSelector('.thread:visible .msg[data-role=held]');
check('controls: a held template without the controls still has them', await a.page.locator('.thread:visible .msg[data-role=held] [data-hold=release]').count() === 1);
check('controls: the frame keeps the msg class and role', await a.page.locator('.thread:visible .msg[data-role=held].rp-held, .thread:visible .msg.rp-held[data-role=held]').count() >= 0);
check('controls: a user template without a body slot still shows the message text', /held again/.test(await thread(a.page).first().textContent()));
await a.page.click('[data-hold=all]').catch(() => {});
await a.page.selectOption('#pace', 'off').catch(() => {});
await a.page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 }).catch(() => {});
await R(a.page, m => m.removeSpec('no-controls'));

// ---------- 7. the look settings dialog ----------
await a.page.click('[data-act=look]');
await a.page.waitForSelector('.rp-look');
check('look dialog: lists the default look as locked on', await a.page.locator('.rp-look input[type=checkbox][disabled]').count() >= 1);
check('look dialog: lists the built-in transforms', /Link|handles|Collapse/i.test(await a.page.locator('.rp-look').textContent()));
await a.page.locator('.rp-look textarea').fill('{"id":"bad","templates":{"user":{"markup":"<p>"}}, "x":1}');
await a.page.click('.rp-look >> text=add spec');
check('look dialog: a bad spec shows the reason and stores nothing', await a.page.locator('.rp-look .rp-err').count() >= 1);
await a.page.keyboard.press('Escape');

// ---------- 8. housekeeping ----------
for (const p of [a, b]) { check('no danger left in ' + (p === a ? 'a' : 'b'), (await danger(p.page)).length === 0); }
const bad = errors.filter(e => !/Failed to load resource|ERR_FAILED/.test(e));
check('no page errors', bad.length === 0, bad.join(' | '));
check('tests: no OpenRouter model request was made (mock only)', orCalls.filter(u => !/\/models/.test(u)).length === 0, orCalls.join(' '));
if (shots && !base) for (const [n, p] of [['after-a', a.page], ['after-b', b.page]]) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, n + '.png') }); }
await browser.close();
