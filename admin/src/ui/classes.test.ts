// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The redesign's rule (CLAUDE.md, Admin CSS): utilities only from the generated theme. No arbitrary values
 * (`p-[13px]`, `bg-[#fff]`, `shadow-[…]`) and no raw colours in class strings; a value the design needs goes into
 * design/tokens.json. ALLOW lists `file: snippet` pairs that are let through, with a reason; it only shrinks.
 */
const ALLOW: Record<string, string> = {};
// Arbitrary variants (`[&_svg]:size-4`) are selectors written in a class string: they fail too, except these, which have
// no theme form (no utility reaches a child by its tag): the icon of a button follows the button's size.
const ALLOWED_VARIANTS = new Set(['[&_svg]:size-4', '[&_svg]:size-5']);

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ARBITRARY = /(?:^|[\s'"`])(?:[a-z0-9-]+:)*-?[a-z][a-z0-9-]*-\[[^\]\s]+\]/;
const ARBITRARY_VARIANT = /\[&(?:[^[\]]|\[[^\]]*\])*\]:[^\s'"`]*/g;
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/i;
// The places a class list is written: className=…, cn(…), cva(…) and its variants.
const CLASS_SITES = /(?:className\s*=\s*(?:\{[^}]*\}|"[^"]*"|'[^']*')|\bcn\([^)]*\)|\bcva\([\s\S]*?\}\s*\))/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('class strings in the admin', () => {
  it('use the generated theme only: no arbitrary values, no raw colours', () => {
    const found: string[] = [];
    for (const path of files(SRC)) {
      const text = readFileSync(path, 'utf8');
      for (const site of text.match(CLASS_SITES) ?? []) {
        const rel = relative(SRC, path);
        if (ALLOW[`${rel}: ${site}`]) continue;
        const variants = (site.match(ARBITRARY_VARIANT) ?? []).filter((v) => !ALLOWED_VARIANTS.has(v));
        if (ARBITRARY.test(site) || RAW_COLOUR.test(site) || variants.length > 0)
          found.push(`${rel}: ${site.slice(0, 80)}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('catches the patterns it is meant to', () => {
    expect(ARBITRARY.test('className="p-[13px]"')).toBe(true);
    expect(ARBITRARY.test("cn('hover:bg-[#fff]')")).toBe(true);
    expect(ARBITRARY.test('className="p-4 bg-card"')).toBe(false);
    expect('cn("[&[readonly]]:bg-card")'.match(ARBITRARY_VARIANT)).toEqual(['[&[readonly]]:bg-card']);
    expect('cn("p-4 read-only:bg-card")'.match(ARBITRARY_VARIANT)).toBeNull();
    expect(RAW_COLOUR.test("cn('text-#fff')")).toBe(true);
    expect(RAW_COLOUR.test('className="bg-card"')).toBe(false);
  });
});
