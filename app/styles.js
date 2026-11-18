// Dynamic style tags. Cosmetic and positional state (which session is visible,
// which row is highlighted, whether a panel is open) lives in one small <style>
// per concern, with selectors that target data attributes on stable DOM nodes.
// Changing that state rewrites one rule; no element is re-rendered or re-classed.

const tags = new Map();

export function rule(key, css) {
  let t = tags.get(key);
  if (!t) {
    t = document.createElement('style');
    t.dataset.bind = key;
    document.head.append(t);
    tags.set(key, t);
  }
  if (t.textContent !== css) t.textContent = css;
}
