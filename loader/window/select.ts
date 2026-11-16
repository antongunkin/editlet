// Select-to-edit, the page side (part of window.js, so it runs only while the editor is open): a selection inside a
// marked entry gets an Edit button; pressing it (or Alt+Shift+E) tells the admin which entry, which field (when marked)
// and which words, so the form can select the same words. The site's DOM is never changed except for the button's
// host, a Shadow root the site's styles cannot reach.
import { WINDOW_SOURCE, type SelectMessage } from './channel';

import { ENTRY_ATTR, FIELD_ATTR } from '../protocol';

/** Characters of the entry's text kept before and after the quote, to tell repeated words apart. */
const CONTEXT = 32;
const WORD = /[\p{L}\p{N}_'’-]/u;

export type Picked = Omit<SelectMessage, 'source' | 'type'> & { rect: DOMRect | null };

const elementOf = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** The word around a caret (a click without a selection), or null when the caret is not in a word. */
function wordAt(range: Range): Range | null {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const data = (node as Text).data;
  let a = range.startOffset;
  let b = a;
  while (a > 0 && WORD.test(data[a - 1]!)) a--;
  while (b < data.length && WORD.test(data[b]!)) b++;
  if (a === b) return null;
  const word = document.createRange();
  word.setStart(node, a);
  word.setEnd(node, b);
  return word;
}

/**
 * The selection as entry, field, quote and context, or `null` when it is outside a marked entry, inside `exclude` (the
 * editor's dialog) or empty. The entry is the one the selection starts in; the text is read from text nodes
 * (`node.data`, not `innerText`, which applies CSS `text-transform`) and clipped to that entry.
 */
export function pickSelection(selection: Selection | null, exclude: Element | null): Picked | null {
  if (!selection || selection.rangeCount === 0) return null;
  let range: Range | null = selection.getRangeAt(0);
  const common = elementOf(range.commonAncestorContainer);
  if (!common || exclude?.contains(common)) return null;
  if (range.collapsed) range = wordAt(range);
  if (!range) return null;

  const entryEl = elementOf(range.startContainer)?.closest(`[${ENTRY_ATTR}]`) ?? null;
  let entry = entryEl?.getAttribute(ENTRY_ATTR) ?? '';
  let field: string | undefined;
  const fieldEl = common.closest(`[${FIELD_ATTR}]`);
  const mark = fieldEl?.getAttribute(FIELD_ATTR) ?? '';
  const hash = mark.lastIndexOf('#');
  if (hash > 0 && (entry === '' || mark.slice(0, hash) === entry)) {
    entry = mark.slice(0, hash);
    field = mark.slice(hash + 1);
  }
  const root = entryEl ?? fieldEl;
  if (entry === '' || !root) return null;

  let text = '';
  let start = -1;
  let end = -1;
  for (const node of textNodes(root)) {
    if (range.intersectsNode(node)) {
      const a = node === range.startContainer ? range.startOffset : 0;
      const b = node === range.endContainer ? range.endOffset : node.length;
      if (start < 0) start = text.length + a;
      end = text.length + b;
    }
    text += node.data;
  }
  const quote = start < 0 ? '' : text.slice(start, end);
  if (quote.trim() === '') return null;
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
  return {
    entry,
    ...(field ? { field } : {}),
    quote,
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    rect: rects && rects.length > 0 ? rects[rects.length - 1]! : null,
  };
}

const CSS =
  'button{position:fixed;z-index:2147483647;display:flex;gap:6px;align-items:center;padding:6px 12px;border:0;' +
  'border-radius:9999px;background:#1c1917;color:#fff;font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;' +
  'box-shadow:0 4px 12px #0003}button[hidden]{display:none}button:focus-visible{outline:2px solid #8b5cf6;outline-offset:2px}';

/**
 * Watches the page's selection while the editor is open and shows the Edit button next to it. `frame` is the admin's
 * iframe (null while the editor is closed), `dialog` the editor's dialog (selections in it are ignored).
 */
export function startSelect(frame: () => HTMLIFrameElement | null, dialog: () => Element | null): void {
  const host = document.createElement('div');
  host.setAttribute('data-editlet-select', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${CSS}</style><button type="button" hidden>✎ Edit</button>`;
  const button = shadow.querySelector('button')!;
  let picked: Picked | null = null;
  let touch = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    button.hidden = true;
    picked = null;
  };
  const update = () => {
    picked = frame()?.isConnected ? pickSelection(document.getSelection(), dialog()) : null;
    const r = picked?.rect;
    if (!picked || !r) return hide();
    if (!host.isConnected) document.body.append(host);
    const w = document.documentElement.clientWidth;
    // Below the end of the selection; with a finger above its start, clear of the system's copy menu.
    button.style.left = `${Math.max(8, Math.min((touch ? r.left : r.right) - 32, w - 96))}px`;
    button.style.top = `${touch ? Math.max(8, r.top - 44) : r.bottom + 8}px`;
    button.setAttribute('aria-label', `Edit in Editlet: ${picked.entry}`);
    button.hidden = false;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  };
  const send = () => {
    const f = frame();
    if (!picked || !f?.contentWindow) return;
    const { rect: _rect, ...body } = picked;
    f.contentWindow.postMessage(
      { source: WINDOW_SOURCE, type: 'select', ...body },
      new URL(f.src, location.href).origin,
    );
    hide();
  };

  document.addEventListener('selectionchange', schedule);
  document.addEventListener('keyup', schedule);
  document.addEventListener('pointerup', (e) => {
    touch = e.pointerType === 'touch';
    schedule();
  });
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    else if (e.altKey && e.shiftKey && e.code === 'KeyE' && !button.hidden) {
      e.preventDefault();
      send();
    }
  });
  // Pressing the button must not clear the selection it is about.
  button.addEventListener('pointerdown', (e) => e.preventDefault());
  button.addEventListener('click', send);
}
