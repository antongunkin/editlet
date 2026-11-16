import { parse, Schema as YamlSchema, stringify } from 'yaml';

import { EditletError, type Issue } from './issues';

export interface EntryFile {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Scalar tags of YAML 1.1 (`yes` / `no` / `on`, timestamps, `12:30:00` sexagesimals, `1_000`, ...). Stringifying
 * with the core schema plus these quotes every string either a YAML 1.2 core reader or a YAML 1.1 reader would read
 * as another type; `version: '1.1'` alone would leave e.g. `0o17` plain, which core reads as a number.
 */
const YAML_11_SCALARS = new YamlSchema({ schema: 'yaml-1.1' }).tags.filter((tag) => !tag.collection);

function fail(message: string): never {
  throw new EditletError([{ path: '', message }]);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Decodes file content as UTF-8 (strings pass through); on invalid bytes returns an issue for `file` instead. */
export function decodeUtf8(content: Uint8Array | string, file: string): { text: string } | { issue: Issue } {
  if (typeof content === 'string') return { text: content };
  try {
    return { text: utf8.decode(content) };
  } catch {
    return { issue: { file, path: '', message: 'File is not valid UTF-8' } };
  }
}

export function parseEntryFile(source: string): EntryFile {
  let text = source.startsWith('﻿') ? source.slice(1) : source;
  text = text.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { data: {}, body: text };

  const rest = text.slice(4);
  const lines = rest.split('\n');
  const close = lines.indexOf('---');
  if (close === -1) fail('Frontmatter is not closed with a "---" line');

  const yamlSrc = lines.slice(0, close).join('\n');
  let body = lines.slice(close + 1).join('\n');
  if (body.startsWith('\n')) body = body.slice(1);

  let data: unknown;
  try {
    data = parse(yamlSrc, { schema: 'core', logLevel: 'error' });
  } catch (error) {
    fail(`Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== 'object' || Array.isArray(data)) fail('Frontmatter must be a YAML mapping');
  return { data: data as Record<string, unknown>, body };
}

export function serializeEntryFile(file: EntryFile, fieldOrder: string[] = []): string {
  const keys = Object.keys(file.data).filter((k) => file.data[k] !== undefined);
  const rank = (k: string) => {
    const i = fieldOrder.indexOf(k);
    return i === -1 ? Infinity : i;
  };
  keys.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0 && !(rank(a) === Infinity && rank(b) === Infinity)) return d;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = file.data[k];

  const yaml =
    keys.length === 0
      ? ''
      : stringify(ordered, {
          version: '1.1',
          schema: 'core',
          customTags: (tags) => [...tags, ...YAML_11_SCALARS],
          lineWidth: 0,
          logLevel: 'error',
        });
  const head = `---\n${yaml}---\n`;
  return file.body === '' ? head : `${head}\n${file.body}`;
}
