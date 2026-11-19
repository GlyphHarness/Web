// The default look, written as the plugin API's own first plugin: every part of a
// session becomes DOM through a template here unless a developer's plugin sits
// above it. Same elements, classes and attributes the app drew before templates
// existed, so nothing visible changes. Styles live in app.css and render.css.
// Spec: docs/RENDER-PLUGINS.md.

import { registerBuiltin, rx, h } from './render.js';

const slots = (ctx, ...names) => names.map(n => ctx.slot(n));

registerBuiltin({
  id: 'core-look',
  name: 'Default look',
  templates: {
    // the log's messages: header, reasoning, the body, tool calls, a copy button
    user: (d, ctx) => h('article', {}, ...slots(ctx, 'head', 'reasoning', 'body', 'calls', 'copy')),
    assistant: (d, ctx) => h('article', {}, ...slots(ctx, 'head', 'reasoning', 'body', 'calls', 'copy')),
    'tool-result': (d, ctx) => h('article', {}, ...slots(ctx, 'head', 'reasoning', 'body', 'extras', 'copy')),

    // one call the model made: its name, id and arguments; stored arguments load on first open
    'tool-call': (d, ctx) => {
      const el = h('details', { class: 'call' }, h('summary', { text: `call ${d.name} (${d.id})` }), h('pre', {}, ctx.text(d.args, { part: 'tool-call' })));
      if (d.hasRef && d.load) el.addEventListener('toggle', async () => {
        if (!el.open || el._full) return;
        el._full = true;
        el.append(h('pre', { class: 'full', text: (await d.load()) ?? 'Stored arguments are not in this browser.' }));
      });
      return el;
    },

    reasoning: (d, ctx) => h('div', { class: 'think' }, ctx.text(d.text, { part: 'reasoning' })),

    // a repository write waits for a click
    approval: (d, ctx) => h('article', { class: 'approve' }, ...slots(ctx, 'ask', 'what', 'files', 'controls')),
    // a model request or tool call held by the pace setting
    held: (d, ctx) => h('article', {}, h('header', { class: 'mhead' }, h('span', { class: 'role', text: d.title }), ctx.slot('status')), ...slots(ctx, 'what', 'controls')),

    // a row in the flags list (smells): kind chip, name, meta, then the note and what changed
    flag: d => h('details', { class: 'item', ...(d.tone ? { 'data-tone': d.tone } : {}), 'data-kind': d.kind },
      h('summary', {}, h('span', { class: 'chip', text: d.kind }), h('span', { class: 'name', text: d.name }), d.meta ? h('span', { class: 'meta', text: d.meta }) : ''),
      h('div', { class: 'body' }, h('p', { class: 'note', text: d.note || '' }), d.from ? h('pre', { text: 'from: ' + d.from + (d.to ? '\nto:   ' + d.to : '') }) : null)),
  },
});

// Text transforms the harness ships. Off until turned on in Look; they show what
// the pipeline does and are the examples a plugin author starts from.
const link = (href, text, cls) => h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: cls, text });

registerBuiltin({
  id: 'core-transforms',
  name: 'Text helpers',
  transforms: [
    { id: 'gh-refs', title: 'Link owner/repo#123 to GitHub', scope: ['assistant', 'user'], defaultOn: false,
      transform: rx(/\b([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})#(\d{1,7})\b/g, m => link(`https://github.com/${m[1]}/issues/${m[2]}`, m[0], 'rp-ref')) },
    { id: 'handles', title: 'Mark stored-output handles (os:…)', scope: ['assistant', 'user', 'tool-result', 'tool-call'], defaultOn: false,
      transform: rx(/\bos:[a-z0-9]{6,12}\b/g, m => h('span', { class: 'rp-handle', title: 'stored output', text: m[0] })) },
    { id: 'collapse-long', title: 'Fold long tool output behind a toggle', scope: ['tool-result'], defaultOn: false,
      transform: s => {
        if (s.length < 1200) return null;
        const lines = s.split('\n');
        if (lines.length < 12) return null;
        return [lines.slice(0, 6).join('\n') + '\n', h('details', { class: 'rp-collapse' }, h('summary', { text: `${lines.length - 6} more lines` }), lines.slice(6).join('\n'))];
      } },
  ],
});
