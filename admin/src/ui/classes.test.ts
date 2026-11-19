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
// The focus ring is the keyboard's (window/modality.ts): `focused:`, `group-focused:` and `has-focused:` carry the guard
// that keeps it off after a tap. The raw pseudo-class variants do not, so they fail. ALLOW_RAW_FOCUS lets through the one
// class that is not a ring: the sheet's close button is screen-reader-only on a touch screen until it is focused.
const RAW_FOCUS = /(?:^|[\s'"`:])(?:group-|has-)?(?:not-)?focus-(?:visible|within):/;
const ALLOW_RAW_FOCUS = new Set(['ui/parts/sheet.tsx: pointer-coarse:not-focus-visible:sr-only']);

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

  it('draw a focus ring only through focused:, group-focused: and has-focused:', () => {
    const found: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path);
      for (const site of readFileSync(path, 'utf8').match(CLASS_SITES) ?? []) {
        for (const token of site.split(/[\s'"`]+/)) {
          if (RAW_FOCUS.test(` ${token}`) && !ALLOW_RAW_FOCUS.has(`${rel}: ${token}`)) found.push(`${rel}: ${token}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('catches the focus patterns it is meant to', () => {
    for (const bad of [
      'focus-visible:inset-ring-2',
      'has-focus-visible:ring',
      'focus-within:ring-2',
      'hovered:focus-visible:x',
    ])
      expect(RAW_FOCUS.test(` ${bad}`), bad).toBe(true);
    for (const ok of ['focused:inset-ring-2', 'has-focused:inset-ring-2', 'group-focused:bg-card', 'focus:x'])
      expect(RAW_FOCUS.test(` ${ok}`), ok).toBe(false);
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

describe('app.css', () => {
  const css = readFileSync(join(SRC, 'app.css'), 'utf8');
  const variant = (name: string) => css.match(new RegExp(`@custom-variant ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
  const GUARD = ":not(:where([data-editlet-modality='pointer'] *))";

  it('guards the keyboard focus variants with the modality attribute and keeps the board state', () => {
    expect(variant('focused')).toContain(`&:focus-visible${GUARD}`);
    expect(variant('focused')).toContain("&[data-state='focus']");
    expect(variant('has-focused')).toContain(`&:has(:focus-visible)${GUARD}`);
    expect(variant('has-focused')).toContain("&[data-state='focus']");
    expect(variant('group-focused')).toContain(`:focus-visible${GUARD} *)`);
    expect(variant('group-focused')).toContain("[data-state='focus']");
  });
});
