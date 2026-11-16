import { describe, expect, it } from 'vitest';

import { isSafeHref } from './links';
import { markdownStyle } from './style';

describe('isSafeHref', () => {
  it('accepts relative paths, anchors, http(s), mailto and tel', () => {
    for (const ok of [
      'a.png',
      '../x/y.md',
      '#top',
      '/abs',
      'https://x.test',
      'HTTP://x.test',
      'mailto:a@b.c',
      'tel:+1',
    ]) {
      expect(isSafeHref(ok)).toBe(true);
    }
  });

  it('refuses other schemes, also when hidden with whitespace or case', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:x',
      'java\tscript:x',
      ' javascript:x',
      'data:text/html,x',
      'vbscript:x',
    ]) {
      expect(isSafeHref(bad)).toBe(false);
    }
  });
});

describe('markdownStyle', () => {
  it('uses the CommonMark defaults for a plain body', () => {
    expect(markdownStyle('Just text.')).toEqual({ bullet: '-', emphasis: '*', strong: '*', fence: '`', rule: '-' });
  });

  it('follows the markers the body uses most, ignoring code samples', () => {
    const body = [
      '* a',
      '* b',
      '+ c',
      '',
      '_em_ and __strong__',
      '',
      '~~~',
      '- not counted',
      '- not counted',
      '~~~',
      '',
      '***',
    ].join('\n');
    expect(markdownStyle(body)).toEqual({ bullet: '*', emphasis: '_', strong: '_', fence: '~', rule: '*' });
  });
});
