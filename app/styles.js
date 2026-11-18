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

// Live display values: the value is a data-v attribute and CSS draws it
// (.slot::after { content: attr(data-v) }). An update is one attribute write; no
// text node is replaced, so focus, selection, scroll and listeners survive and the
// devtools tree does not churn. For values nobody needs to copy: counts, statuses,
// sums. slotText() reads an element's text with its slot values included.
export function slot(el, v) {
  if (!el) return;
  if (!el.classList.contains('slot')) { el.classList.add('slot'); el.textContent = ''; }
  const s = v == null ? '' : String(v);
  if (el.getAttribute('data-v') !== s) el.setAttribute('data-v', s);
}
export function slotText(el) {
  if (!el) return '';
  const c = el.cloneNode(true);
  for (const s of [c, ...c.querySelectorAll('.slot')]) if (s.classList?.contains('slot')) s.textContent = s.getAttribute('data-v') || '';
  return c.textContent;
}
