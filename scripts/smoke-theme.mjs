// Theme smoke test (docs/THEME.md). Usage: serve the repo root, then: node scripts/smoke-theme.mjs [url]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:8787/';
const shot = process.argv[3]; // optional prefix for screenshots
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});

const open = async (colorScheme, init) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); // a missing favicon is not ours
  if (init) await page.addInitScript(init);
  await page.goto(url);
  await page.waitForSelector('#theme');
  return { ctx, page, errors };
};
const vars = page => page.evaluate(() => { const c = getComputedStyle(document.documentElement); return { bg: c.getPropertyValue('--bg').trim(), panel: c.getPropertyValue('--panel').trim(), card: c.getPropertyValue('--card').trim(), scheme: c.colorScheme, body: getComputedStyle(document.body).backgroundColor, attr: document.documentElement.dataset.theme }; });
const DARK = '#14161a', LIGHT = '#f6f7f9';

// system follows the OS
for (const [os, want] of [['dark', DARK], ['light', LIGHT]]) {
  const { ctx, page, errors } = await open(os);
  const v = await vars(page);
  check(`system on ${os} OS`, v.attr === 'system' && v.bg === want, JSON.stringify(v));
  check(`alias --panel follows --card (${os})`, v.panel === v.card);
  if (os === 'dark') {
    const rgb = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('body paints with the token', rgb === 'rgb(20, 22, 26)', rgb);
    // OS change while in system mode: onChange fires and the page follows
    await page.evaluate(async () => { const t = await import('./app/theme.js'); window.__seen = []; t.onChange((m, r) => window.__seen.push(m + ':' + r)); });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => window.__seen.length === 1);
    const v2 = await vars(page);
    check('system follows a live OS change', v2.bg === LIGHT && (await page.evaluate(() => window.__seen[0])) === 'system:light', JSON.stringify(v2));
  }
  check(`no page errors (system/${os})`, errors.length === 0, errors.join('|'));
  await ctx.close();
}

// explicit choice beats the OS, persists across reload, and the control reflects it
{
  const { ctx, page, errors } = await open('dark');
  await page.selectOption('#theme', 'light');
  let v = await vars(page);
  check('light chosen on a dark OS', v.attr === 'light' && v.bg === LIGHT && v.scheme === 'light', JSON.stringify(v));
  check('stored under wh:theme', await page.evaluate(() => localStorage.getItem('wh:theme')) === 'light');
  await page.reload();
  await page.waitForSelector('#theme');
  v = await vars(page);
  check('light survives reload', v.bg === LIGHT && await page.inputValue('#theme') === 'light', JSON.stringify(v));
  if (shot) await page.screenshot({ path: `${shot}-light.png` });
  await page.selectOption('#theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  v = await vars(page);
  check('dark chosen on a light OS', v.attr === 'dark' && v.bg === DARK && v.scheme === 'dark', JSON.stringify(v));
  if (shot) await page.screenshot({ path: `${shot}-dark.png` });
  await page.selectOption('#theme', 'system');
  v = await vars(page);
  check('back to system follows the OS', v.attr === 'system' && v.bg === LIGHT, JSON.stringify(v));
  const api = await page.evaluate(async () => { const t = await import('./app/theme.js'); return [t.get(), t.resolved(), t.set('bogus')]; });
  check('API: get/resolved/set(invalid)', api.join() === 'system,light,system', api.join());
  check('no page errors (chosen)', errors.length === 0, errors.join('|'));
  await ctx.close();
}

// another tab's choice arrives through the storage event
{
  const { ctx, page } = await open('dark');
  const p2 = await ctx.newPage(); await p2.goto(url); await p2.waitForSelector('#theme');
  await p2.selectOption('#theme', 'light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check('change in another tab applies here', (await vars(page)).bg === LIGHT && await page.inputValue('#theme') === 'light');
  await ctx.close();
}

// storage that throws for the theme key does not break the page
{
  const { ctx, page, errors } = await open('dark', () => { for (const m of ['getItem', 'setItem']) { const o = Storage.prototype[m]; Storage.prototype[m] = function (k, ...a) { if (k === 'wh:theme') throw new Error('blocked'); return o.call(this, k, ...a); }; } });
  await page.selectOption('#theme', 'light');
  check('works with the theme key blocked', (await vars(page)).bg === LIGHT && errors.length === 0, errors.join('|'));
  await ctx.close();
}
await browser.close();
