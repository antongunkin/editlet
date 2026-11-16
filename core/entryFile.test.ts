import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseEntryFile, serializeEntryFile } from './entryFile';
import { EditletError } from './issues';

describe('entry file format', () => {
  it('parses frontmatter and body', () => {
    expect(parseEntryFile('---\ntitle: Hi\n---\n\n# Body\n')).toEqual({ data: { title: 'Hi' }, body: '# Body\n' });
  });

  it('keeps date-like scalars as strings (YAML 1.2 core)', () => {
    const { data } = parseEntryFile('---\npublishedAt: 2026-01-01\nanswer: no\nyear: 2026\n---\n');
    expect(data.publishedAt).toBe('2026-01-01');
    expect(data.answer).toBe('no');
    expect(data.year).toBe(2026);
  });

  it('serializer quotes strings that would re-parse as another type', () => {
    const out = serializeEntryFile({ data: { title: '2026', flag: 'true', none: 'null' }, body: '' });
    const { data } = parseEntryFile(out);
    expect(data.title).toBe('2026');
    expect(data.flag).toBe('true');
    expect(data.none).toBe('null');
  });

  it('quotes strings that YAML 1.1 readers would read as dates, times or booleans', () => {
    const data = {
      a: '2026-01-01',
      b: '12:30:00',
      c: 'no',
      d: 'yes',
      e: 'on',
      f: 'off',
      g: 'y',
      h: '0o17',
      i: '1_000',
      j: '2026-01-01T10:00:00Z',
    };
    const out = serializeEntryFile({ data, body: '' });
    for (const v of ['2026-01-01', '12:30:00', 'no', 'yes', 'on', 'off', 'y', '0o17', '1_000']) {
      expect(out).toContain(`"${v}"`);
    }
    expect(parseEntryFile(out).data).toEqual(data);
    expect(parse(out.slice(4, -4), { version: '1.1', logLevel: 'silent' })).toEqual(data);
  });

  it('keeps non-string scalars plain', () => {
    const data = { count: 3, ratio: 1.5, flag: true, none: null, list: ['no', 2], obj: { yes: 'on' } };
    const out = serializeEntryFile({ data, body: '' });
    expect(out).toContain('count: 3\n');
    expect(out).toContain('ratio: 1.5\n');
    expect(out).toContain('flag: true\n');
    expect(out).toContain('none: null\n');
    expect(parseEntryFile(out).data).toEqual(data);
  });

  it('handles CRLF and BOM', () => {
    expect(parseEntryFile('﻿---\r\ntitle: Hi\r\n---\r\nBody')).toEqual({ data: { title: 'Hi' }, body: 'Body' });
  });

  it('handles no frontmatter and empty frontmatter', () => {
    expect(parseEntryFile('just text\n')).toEqual({ data: {}, body: 'just text\n' });
    expect(parseEntryFile('---\n---\nX')).toEqual({ data: {}, body: 'X' });
  });

  it('keeps a body with --- lines whole', () => {
    const body = 'a\n\n---\n\nb\n---\n';
    const out = serializeEntryFile({ data: { title: 'T' }, body });
    expect(parseEntryFile(out)).toEqual({ data: { title: 'T' }, body });
  });

  it('throws EditletError on invalid YAML, list frontmatter and unclosed frontmatter', () => {
    expect(() => parseEntryFile('---\ntitle: [unclosed\n---\n')).toThrow(EditletError);
    expect(() => parseEntryFile('---\n- a\n- b\n---\n')).toThrow(EditletError);
    expect(() => parseEntryFile('---\ntitle: Hi\nno end')).toThrow(EditletError);
  });

  it('orders keys by fieldOrder, unknown keys last alphabetically', () => {
    const out = serializeEntryFile({ data: { zeta: 1, title: 'T', alpha: 2, tags: ['a'] }, body: '' }, [
      'title',
      'tags',
    ]);
    expect(out).toBe('---\ntitle: T\ntags:\n  - a\nalpha: 2\nzeta: 1\n---\n');
  });

  it('drops undefined values', () => {
    expect(serializeEntryFile({ data: { a: undefined, b: 1 }, body: '' })).toBe('---\nb: 1\n---\n');
  });

  it('emits an empty frontmatter block for empty data', () => {
    expect(serializeEntryFile({ data: {}, body: 'X' })).toBe('---\n---\n\nX');
  });

  it('round trip is stable', () => {
    const x = { data: { title: '2026', n: 3, list: ['a', 'b'], d: '2026-01-01' }, body: '# H\n\ntext\n' };
    const once = serializeEntryFile(x);
    expect(serializeEntryFile(parseEntryFile(once))).toBe(once);
  });
});
