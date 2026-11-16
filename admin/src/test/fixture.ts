// The node fixture site as files, Node-only (no React): shared by the test renderers, the GitHub fake and the dev host.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FIXTURE_SITE = join(import.meta.dirname, '../../../node/__fixtures__/site');

const TEXT_EXT = /\.(md|json|ts|txt|yaml|yml)$/;

/** The node fixture site as `{ 'cms/schema.json': text, 'cms/content/post/hello-world/cover.webp': bytes, ... }`. */
export function fixtureFiles(): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};
  for (const entry of readdirSync(FIXTURE_SITE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    const path = relative(FIXTURE_SITE, abs).split(sep).join('/');
    out[path] = TEXT_EXT.test(path) ? readFileSync(abs, 'utf8') : new Uint8Array(readFileSync(abs));
  }
  return out;
}
