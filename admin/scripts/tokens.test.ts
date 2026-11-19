import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { main, render, type TokensJson } from './tokens';

const FIXTURE: TokensJson = {
  color: {
    background: { $type: 'color', $value: '#F5F5F4', $extensions: { editlet: { dark: '#0A0A0A' } } },
    'on-ink': { $type: 'color', $value: '#FFFFFF', $extensions: { editlet: { dark: '#FFFFFF' } } },
  },
  shadow: {
    card: {
      $type: 'shadow',
      $value: [
        { color: '#0000000A', offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', inset: false },
        { color: '{color.on-ink}', offsetX: '0px', offsetY: '-1px', blur: '0px', spread: '0px', inset: true },
      ],
      $extensions: {
        editlet: {
          dark: [
            { color: '#FFFFFF0F', offsetX: '0px', offsetY: '1px', blur: '0px', spread: '0px', inset: true },
            { color: '#00000066', offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', inset: false },
          ],
        },
      },
    },
  },
  gradient: {
    ink: {
      $type: 'gradient',
      $value: [
        { color: '#3F3F46', position: 0 },
        { color: '#18181B', position: 1 },
      ],
      $extensions: {
        editlet: {
          dark: [
            { color: '#52525B', position: 0 },
            { color: '#27272A', position: 1 },
          ],
        },
      },
    },
  },
  scale: {
    spacing: '0.25rem',
    text: { sm: [14, 20] },
    weight: { medium: 500 },
    radius: { xl: 12 },
    container: { wide: 576 },
    motion: { tab: ['200ms', 'cubic-bezier(.2,.8,.2,1)'] },
  },
  icon: { plus: 'M5 12h14M12 5v14', 'arrow-left': 'm12 19-7-7 7-7M19 12H5' },
};

describe('render', () => {
  const { css, ts } = render(FIXTURE);

  it('writes both themes, the shadcn mapping, the reset theme and a utility per gradient', () => {
    expect(css).toMatchSnapshot();
  });

  it('resolves a colour reference to the colour variable, so shadows follow the theme', () => {
    expect(css).toContain('--elevation-card: 0 1px 2px 0 #0000000A, inset 0 -1px 0 0 var(--on-ink);');
  });

  it('gives every shadow and gradient a Dark value, and the theme shadow follows it', () => {
    expect(css).toContain('--elevation-card: inset 0 1px 0 0 #FFFFFF0F, 0 1px 2px 0 #00000066;');
    expect(css).toContain('--gradient-ink: linear-gradient(#52525B, #27272A);');
    expect(css).toContain('--shadow-card: var(--elevation-card);');
  });

  it('writes the icon paths as ICONS and the IconName type', () => {
    expect(render(FIXTURE).icons).toMatchSnapshot();
  });

  it('writes the same values as data for tests', () => {
    expect(ts).toContain("background: { light: '#F5F5F4', dark: '#0A0A0A' },");
    expect(ts).toContain(
      "ink: { light: 'linear-gradient(#3F3F46, #18181B)', dark: 'linear-gradient(#52525B, #27272A)' },",
    );
  });
});

describe('main', () => {
  const dir = mkdtempSync(join(tmpdir(), 'editlet-tokens-'));
  const paths = {
    json: join(dir, 'tokens.json'),
    css: join(dir, 'theme.css'),
    ts: join(dir, 'tokens.ts'),
    icons: join(dir, 'icons.ts'),
  };
  writeFileSync(paths.json, JSON.stringify(FIXTURE));

  it('writes the files, then --check passes; a stale file fails --check', async () => {
    expect(await main([], paths)).toBe(0);
    expect(readFileSync(paths.css, 'utf8')).toBe(render(FIXTURE).css);
    expect(await main(['--check'], paths)).toBe(0);
    writeFileSync(paths.css, '/* edited by hand */');
    expect(await main(['--check'], paths)).toBe(1);
    expect(await main([], paths)).toBe(0);
    writeFileSync(paths.icons, '// edited by hand');
    expect(await main(['--check'], paths)).toBe(1);
  });
});
