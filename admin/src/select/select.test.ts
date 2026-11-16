import { describe, expect, it, vi } from 'vitest';

import { findQuote, type Candidate } from './match';
import { normalize } from './normalize';
import { projectMarkdown } from './project';

const plain = (key: string, text: string): Candidate => ({ key, projection: { text, select: vi.fn() } });
const q = (quote: string, prefix = '', suffix = '') => ({ quote, prefix, suffix });

describe('normalize', () => {
  it('folds case, quotes, dashes, NBSP and whitespace, drops invisible characters, and maps back', () => {
    const n = normalize('“Café” —  it­em…');
    expect(n.text).toBe('"café" - item...');
    expect(n.map).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14, 15, 15, 15]);
  });
});

describe('projectMarkdown', () => {
  it('shows the text without markup and maps each character to the source', async () => {
    const source =
      '# Title\n\nWe ship **small, [fast](https://x.test)** sites \\* `now`.\n\n- one\n- two\n\n```js\ncode here\n```\n';
    const { text, at } = await projectMarkdown(source);
    expect(text).toBe('Title\nWe ship small, fast sites * now.\none\ntwo\ncode here');
    const pick = (s: string) => {
      const i = text.indexOf(s);
      return source.slice(at[i]!, at[i + s.length - 1]! + 1);
    };
    expect(pick('small, fast')).toBe('small, [fast');
    expect(pick('fast')).toBe('fast');
    expect(pick('* now')).toBe('* `now');
    expect(pick('two')).toBe('two');
    expect(pick('code here')).toBe('code here');
  });

  it('maps entities and soft line breaks', async () => {
    const source = 'Tom &amp; Jerry\nsecond line';
    const { text, at } = await projectMarkdown(source);
    expect(text).toBe('Tom & Jerry\nsecond line');
    const i = text.indexOf('Jerry');
    expect(source.slice(at[i]!, at[i + 4]! + 1)).toBe('Jerry');
  });
});

describe('findQuote', () => {
  it('finds an exact quote across case and typography, in the right candidate', () => {
    const hit = findQuote(
      [plain('title', 'Hello world'), plain('summary', 'It’s a “small” site')],
      q('it\'s a "SMALL"'),
    );
    expect(hit).toEqual({ key: 'summary', start: 0, end: 14 });
  });

  it('tells repeats apart by prefix and suffix, and refuses a tie', () => {
    const c = [plain('body', 'the cat sat. the cat ran.')];
    expect(findQuote(c, q('cat', 'the ', ' ran'))).toEqual({ key: 'body', start: 17, end: 20 });
    expect(findQuote(c, q('cat', 'the ', ''))).toBeNull();
  });

  it('falls back to a fuzzy match within 15 % errors, and gives up beyond', () => {
    const c = [plain('body', 'Lisbon rewards walking up the hills every day')];
    expect(findQuote(c, q('Lisbon rewards walkin up the hills'))).toMatchObject({ key: 'body', start: 0 });
    expect(findQuote(c, q('Porto punishes running'))).toBeNull();
  });

  it('returns null for a blank quote', () => {
    expect(findQuote([plain('a', 'x')], q('   '))).toBeNull();
  });
});
