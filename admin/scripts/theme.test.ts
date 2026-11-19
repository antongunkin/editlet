// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

/**
 * The committed theme (src/ui/tokens/theme.css) compiled by Tailwind as the admin's app.css does: the theme's
 * utilities exist, Tailwind's defaults do not (the `@theme` reset), and the reset does not wipe the colours.
 */
const ADMIN_SRC = fileURLToPath(new URL('../src/', import.meta.url));

async function utilities(candidates: string[]): Promise<string> {
  const css = `@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import './ui/tokens/theme.css';
@import 'tailwindcss/utilities.css' layer(utilities);`;
  const compiler = await compile(css, { base: ADMIN_SRC, onDependency: () => {} });
  return compiler.build(candidates);
}

describe('the generated theme in Tailwind', () => {
  it('has the colour, shadow, gradient and scale utilities of design/tokens.json', async () => {
    const used = [
      'bg-card',
      'text-muted-foreground',
      'border-border',
      'shadow-card',
      'bg-gradient-ink',
      'p-4',
      'rounded-xl',
      'text-sm',
      'font-medium',
    ];
    const out = await utilities(used);
    for (const cls of used) expect(out, cls).toContain(`.${cls} {`);
    expect(out).toContain('background-color: var(--card)'); // @theme inline: the theme variable, so Dark applies
  });

  it('has none of Tailwind’s default palette, radii or shadows', async () => {
    const out = await utilities(['text-red-500', 'bg-zinc-900', 'rounded-lg', 'shadow-md', 'text-5xl']);
    for (const cls of ['text-red-500', 'bg-zinc-900', 'rounded-lg', 'shadow-md', 'text-5xl'])
      expect(out).not.toContain(`.${cls} {`);
  });
});
