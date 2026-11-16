import { describe, expect, it } from 'vitest';

import { applySnapshot, PILL_ATTR } from './match';

import type { PreviewSnapshot, PreviewValue } from '../protocol';

const url = (b: Blob) => `blob:stub-${b.size}`;
const snap = (entries: Record<string, Record<string, PreviewValue>>): PreviewSnapshot => ({
  v: 1,
  branch: 'editlet/x',
  expiresAt: Date.now() + 1000,
  entries,
});
const text = (from: string, to: string): PreviewValue => ({ text: { from, to } });
const altImage = (alt: string): PreviewValue => ({
  image: { from: '', to: new Blob(['x']), alt: { from: '', to: alt } },
});
const html = (s: string) => {
  document.body.innerHTML = s;
  return document;
};

describe('applySnapshot', () => {
  it('patches text inside the entry container', () => {
    html('<article data-editlet-entry="post/a"><h1>Old</h1></article>');
    const r = applySnapshot(document, snap({ 'post/a': { title: text('Old', 'New') } }), url);
    expect(document.querySelector('h1')!.textContent).toBe('New');
    expect(r.patched).toBe(1);
    expect(r.pending).toBe(0);
  });

  it('scopes matches to the entry container', () => {
    html(
      '<article data-editlet-entry="post/a"><h1>Old</h1><nav>Old</nav></article>' +
        '<article data-editlet-entry="post/b"><h1>Old</h1></article>',
    );
    applySnapshot(document, snap({ 'post/a': { title: text('Old', 'New') } }), url);
    expect([...document.querySelectorAll('h1,nav')].map((e) => e.textContent)).toEqual(['New', 'New', 'Old']);
  });

  it('falls back to the whole document without containers', () => {
    html('<main><h1>Old</h1></main>');
    const r = applySnapshot(document, snap({ 'post/a': { title: text('Old', 'New') } }), url);
    expect(document.querySelector('h1')!.textContent).toBe('New');
    expect(r.patched).toBe(1);
  });

  it('patches document.title when equal', () => {
    html('<p>x</p>');
    document.title = 'Old';
    applySnapshot(document, snap({ 'post/a': { title: text('Old', 'New') } }), url);
    expect(document.title).toBe('New');
  });

  it('keeps surrounding whitespace', () => {
    html('<p>\n  Old  </p>');
    applySnapshot(document, snap({ 'post/a': { title: text('Old', 'New') } }), url);
    expect(document.querySelector('p')!.textContent).toBe('\n  New  ');
  });

  it('writes text, never HTML', () => {
    html('<h1>Old</h1>');
    applySnapshot(document, snap({ 'post/a': { title: text('Old', '<b>x</b>') } }), url);
    expect(document.querySelector('h1')!.textContent).toBe('<b>x</b>');
    expect(document.querySelector('b')).toBeNull();
  });

  it('prefers marks over value matching', () => {
    html('<h1 data-editlet-field="post/a#title">Branch</h1><p>Old</p>');
    const r = applySnapshot(document, snap({ 'post/a': { title: text('Old', 'New') } }), url);
    expect(document.querySelector('h1')!.textContent).toBe('New');
    expect(document.querySelector('p')!.textContent).toBe('Old');
    expect(r.patched).toBe(1);
  });

  it('patches images by contained path and encoded path', () => {
    const path = '/editlet/content/post/a/c.webp';
    html(
      `<img id="a" src="${path}" alt="old">` +
        `<img id="b" src="/_next/image?url=${encodeURIComponent(path)}&w=640" srcset="/_next/image?url=${encodeURIComponent(path)}&w=640 1x" alt="old">`,
    );
    const to = new Blob(['abc']);
    const r = applySnapshot(
      document,
      snap({ 'post/a': { cover: { image: { from: path, to, alt: { from: 'old', to: 'new' } } } } }),
      url,
    );
    for (const id of ['a', 'b']) {
      const img = document.getElementById(id)!;
      expect(img.getAttribute('src')).toBe('blob:stub-3');
      expect(img.hasAttribute('srcset')).toBe(false);
      expect(img.getAttribute('alt')).toBe('new');
    }
    expect(r.patched).toBe(1);
  });

  it('counts stale and unmatched as pending', () => {
    html('<p>nothing</p>');
    const r = applySnapshot(document, snap({ 'post/a': { a: { stale: true }, b: text('Zzz', 'Y') } }), url);
    expect(r.patched).toBe(0);
    expect(r.pending).toBe(2);
  });

  it('skips the admin dialog and the pill', () => {
    html(`<dialog data-editlet><p>Old</p></dialog><div ${PILL_ATTR}><span>Old</span></div><p>Old</p>`);
    applySnapshot(document, snap({ 'post/a': { title: text('Old', 'New') } }), url);
    expect([...document.querySelectorAll('p,span')].map((e) => e.textContent)).toEqual(['Old', 'Old', 'New']);
  });

  it('restore puts originals back and apply/restore/apply is idempotent', () => {
    const path = '/m/c.webp';
    html(`<h1>Old</h1><img src="${path}" srcset="${path} 1x" alt="a">`);
    document.title = 'Old';
    const s = snap({
      'post/a': {
        title: text('Old', 'New'),
        cover: { image: { from: path, to: new Blob(['x']), alt: { from: 'a', to: 'b' } } },
      },
    });
    const first = applySnapshot(document, s, url);
    first.restore();
    const img = document.querySelector('img')!;
    expect(document.querySelector('h1')!.textContent).toBe('Old');
    expect(img.getAttribute('src')).toBe(path);
    expect(img.getAttribute('srcset')).toBe(`${path} 1x`);
    expect(img.getAttribute('alt')).toBe('a');
    expect(document.title).toBe('Old');
    const second = applySnapshot(document, s, url);
    expect(second.patched).toBe(2);
    expect(document.querySelector('h1')!.textContent).toBe('New');
    second.restore();
    expect(document.querySelector('h1')!.textContent).toBe('Old');
  });

  it('restores mark-patched elements', () => {
    html('<h1 data-editlet-field="post/a#title"><i>Br</i>anch</h1>');
    const r = applySnapshot(document, snap({ 'post/a': { title: text('x', 'New') } }), url);
    expect(document.querySelector('h1')!.textContent).toBe('New');
    r.restore();
    expect(document.querySelector('h1')!.innerHTML).toBe('<i>Br</i>anch');
  });

  it('preserves the text node identity on the mark path', () => {
    html('<h1 data-editlet-field="post/a#title">Branch</h1>');
    const node = document.querySelector('h1')!.firstChild;
    applySnapshot(document, snap({ 'post/a': { title: text('x', 'New') } }), url);
    expect(document.querySelector('h1')!.firstChild).toBe(node);
    expect(node!.nodeValue).toBe('New');
  });

  it('restore keeps values changed externally after patching', () => {
    const path = '/m/c.webp';
    html(
      `<h1>Old</h1><h2 data-editlet-field="post/a#sub"><i>a</i>b</h2><img src="${path}" srcset="${path} 1x" alt="a">`,
    );
    document.title = 'Old';
    const r = applySnapshot(
      document,
      snap({
        'post/a': {
          title: text('Old', 'New'),
          sub: text('x', 'Sub'),
          cover: { image: { from: path, to: new Blob(['x']), alt: { from: 'a', to: 'b' } } },
        },
      }),
      url,
    );
    const h1 = document.querySelector('h1')!;
    const img = document.querySelector('img')!;
    h1.firstChild!.nodeValue = 'Newer';
    document.querySelector('h2')!.append('more');
    img.setAttribute('src', '/react.png');
    img.setAttribute('srcset', '/react.png 1x');
    img.setAttribute('alt', 'react');
    document.title = 'Router';
    r.restore();
    expect(h1.textContent).toBe('Newer');
    expect(document.querySelector('h2')!.textContent).toBe('Submore');
    expect(img.getAttribute('src')).toBe('/react.png');
    expect(img.getAttribute('srcset')).toBe('/react.png 1x');
    expect(img.getAttribute('alt')).toBe('react');
    expect(document.title).toBe('Router');
  });

  it('trims from before matching', () => {
    html('<p>Old</p>');
    applySnapshot(document, snap({ 'post/a': { title: text('  Old ', 'New') } }), url);
    expect(document.querySelector('p')!.textContent).toBe('New');
  });

  it('ignores marks and images inside the dialog and pill', () => {
    html(
      `<dialog data-editlet><h1 data-editlet-field="post/a#title">Old</h1><img src="/m/c.webp"></dialog>` +
        `<div ${PILL_ATTR}><img src="/m/c.webp"></div><p>Old</p><img id="s" src="/m/c.webp">`,
    );
    const to = new Blob(['x']);
    applySnapshot(
      document,
      snap({ 'post/a': { title: text('Old', 'New'), cover: { image: { from: '/m/c.webp', to } } } }),
      url,
    );
    expect(document.querySelector('p')!.textContent).toBe('New');
    expect(document.querySelector('h1')!.textContent).toBe('Old');
    expect([...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      '/m/c.webp',
      '/m/c.webp',
      'blob:stub-1',
    ]);
  });

  it('restores mark-path images', () => {
    html('<div data-editlet-field="post/a#cover"><img src="/a.png" srcset="/a.png 1x" alt="a"></div>');
    const r = applySnapshot(
      document,
      snap({ 'post/a': { cover: { image: { from: '', to: new Blob(['xy']), alt: { from: 'a', to: 'b' } } } } }),
      url,
    );
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('blob:stub-2');
    r.restore();
    expect([img.getAttribute('src'), img.getAttribute('srcset'), img.getAttribute('alt')]).toEqual([
      '/a.png',
      '/a.png 1x',
      'a',
    ]);
  });

  it('restore removes an attribute that was absent before a double patch', () => {
    html(
      '<div data-editlet-field="post/a#cover"><div data-editlet-field="post/a#thumb"><img src="/a.png"></div></div>',
    );
    const r = applySnapshot(document, snap({ 'post/a': { cover: altImage('A'), thumb: altImage('B') } }), url);
    const img = document.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('B');
    r.restore();
    expect(img.hasAttribute('alt')).toBe(false);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.getAttribute('src')).toBe('/a.png');
  });

  it('applying twice without restore is stable', () => {
    html('<h1>Old</h1>');
    const s = snap({ 'post/a': { title: text('Old', 'New') } });
    applySnapshot(document, s, url);
    applySnapshot(document, s, url);
    expect(document.querySelector('h1')!.textContent).toBe('New');
  });
});
