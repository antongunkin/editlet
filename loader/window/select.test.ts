import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSelectMessage, WINDOW_SOURCE } from './channel';
import { pickSelection, startSelect } from './select';

afterEach(() => {
  document.body.innerHTML = '';
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function page(html: string) {
  document.body.innerHTML = html;
}

/** Selects from `startText` (offset) to `endText` (offset), text nodes found by their content. */
function select(start: [string, number], end: [string, number] = start) {
  const find = (needle: string) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.includes(needle)) return n;
    throw new Error(`no text ${needle}`);
  };
  const range = document.createRange();
  range.setStart(find(start[0]), start[1]);
  range.setEnd(find(end[0]), end[1]);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

describe('pickSelection', () => {
  it('reads entry, quote and context from text nodes across inline markup', () => {
    page('<article data-editlet-entry="post/hello"><p>We ship <b>small, fast</b> sites today.</p></article>');
    const picked = pickSelection(select(['We ship', 3], ['small, fast', 5]), null);
    expect(picked).toMatchObject({
      entry: 'post/hello',
      quote: 'ship small',
      prefix: 'We ',
      suffix: ', fast sites today.',
    });
    expect(picked?.field).toBeUndefined();
  });

  it('takes the field from a data-editlet-field mark (and the entry from it when there is no entry mark)', () => {
    page('<h1 data-editlet-field="page/about#title">About us</h1>');
    expect(pickSelection(select(['About us', 0], ['About us', 5]), null)).toMatchObject({
      entry: 'page/about',
      field: 'title',
      quote: 'About',
    });
  });

  it('turns a click without a selection into the word under the caret', () => {
    page('<article data-editlet-entry="post/a"><p>Hello wonderful world</p></article>');
    expect(pickSelection(select(['Hello', 9]), null)?.quote).toBe('wonderful');
    expect(pickSelection(select(['Hello', 5]), null)?.quote).toBe('Hello');
  });

  it('keeps the context to 32 characters and clips a selection running into another entry', () => {
    const long = 'x'.repeat(50);
    page(
      `<article data-editlet-entry="post/a"><p>${long} target ${long}</p></article>` +
        '<article data-editlet-entry="post/b"><p>Other entry</p></article>',
    );
    const picked = pickSelection(select([long, 51], ['Other entry', 5]), null)!;
    expect(picked.entry).toBe('post/a');
    expect(picked.quote).toBe(`target ${long}`);
    expect(picked.prefix).toHaveLength(32);
    expect(picked.suffix).toBe('');
  });

  it('ignores selections outside a marked entry, inside the editor dialog, and blank ones', () => {
    page(
      '<p>Plain page</p><dialog data-editlet open><p>Editor text</p></dialog><article data-editlet-entry="p/a"><p>a   b</p></article>',
    );
    expect(pickSelection(select(['Plain page', 0], ['Plain page', 5]), null)).toBeNull();
    const dialog = document.querySelector('dialog')!;
    expect(pickSelection(select(['Editor text', 0], ['Editor text', 6]), dialog)).toBeNull();
    expect(pickSelection(select(['a   b', 1], ['a   b', 4]), null)).toBeNull();
  });
});

describe('startSelect', () => {
  it('shows an Edit button for the selection and posts select to the admin on click', () => {
    vi.useFakeTimers();
    page(
      '<dialog data-editlet open><iframe src="/editlet/"></iframe></dialog><article data-editlet-entry="post/hello"><p>Hello world</p></article>',
    );
    const iframe = document.querySelector('iframe')!;
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    Range.prototype.getClientRects = () =>
      [{ left: 10, right: 60, top: 20, bottom: 40 } as DOMRect] as unknown as DOMRectList;
    startSelect(
      () => iframe,
      () => document.querySelector('dialog'),
    );
    select(['Hello world', 6], ['Hello world', 11]);
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(250);
    const host = document.querySelector('[data-editlet-select]');
    expect(host).not.toBeNull();
    // A closed Shadow root: reach the button through the key handler instead.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', altKey: true, shiftKey: true }));
    expect(post).toHaveBeenCalledWith(
      { source: WINDOW_SOURCE, type: 'select', entry: 'post/hello', quote: 'world', prefix: 'Hello ', suffix: '' },
      location.origin,
    );
    expect(isSelectMessage(post.mock.calls[0]![0])).toBe(true);
  });

  it('does nothing while the editor is closed', () => {
    vi.useFakeTimers();
    page('<article data-editlet-entry="post/hello"><p>Hello world</p></article>');
    startSelect(
      () => null,
      () => null,
    );
    select(['Hello world', 0], ['Hello world', 5]);
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(250);
    expect(document.querySelector('[data-editlet-select]')).toBeNull();
  });
});

describe('isSelectMessage', () => {
  it('accepts a well-formed message and rejects others', () => {
    const ok = { source: WINDOW_SOURCE, type: 'select', entry: 'post/a', quote: 'x', prefix: '', suffix: '' };
    expect(isSelectMessage(ok)).toBe(true);
    expect(isSelectMessage({ ...ok, field: 'title' })).toBe(true);
    expect(isSelectMessage({ ...ok, quote: '  ' })).toBe(false);
    expect(isSelectMessage({ ...ok, entry: '' })).toBe(false);
    expect(isSelectMessage({ ...ok, field: 3 })).toBe(false);
    expect(isSelectMessage({ ...ok, source: 'other' })).toBe(false);
  });
});
