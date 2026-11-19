import { describe, expect, it } from 'vitest';

import { composite, contrastRatio } from './contrast';
import { TOKENS } from './tokens';

type Mode = 'light' | 'dark';

const value = (name: string, mode: Mode): string => {
  const c = TOKENS.color[name as keyof typeof TOKENS.color];
  if (!c) throw new Error(`no colour token ${name}`);
  return c[mode];
};

/** The stops of a gradient token (`linear-gradient(#a, #b)`). */
const stops = (name: string, mode: Mode): string[] => {
  const g = TOKENS.gradient[name as keyof typeof TOKENS.gradient];
  if (!g) throw new Error(`no gradient token ${name}`);
  return g[mode].match(/#[0-9A-F]{6,8}/gi) ?? [];
};

/**
 * The pairs the design draws (spec 2026-11-18, research §4.3): text ≥ 4.5 : 1, non-text (edges, rings, the grabber)
 * ≥ 3 : 1. A background may sit on another (a tint over the tray), written `tint-unsaved/background`.
 */
const PAIRS: [fg: string, bg: string, min: number][] = [
  ['foreground', 'background', 4.5],
  ['foreground', 'card', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['tray-muted-foreground', 'background', 4.5],
  ['tray-muted-foreground', 'track', 4.5],
  ['input', 'card', 3],
  ['ring', 'card', 3],
  ['ring', 'background', 3],
  ['destructive', 'card', 3],
  ['destructive-foreground', 'destructive', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['chart-1', 'background', 4.5],
  ['chart-2', 'background', 4.5],
  ['tint-unsaved-foreground', 'tint-unsaved/background', 4.5],
  ['tint-success-foreground', 'tint-success/background', 4.5],
  ['tint-review-foreground', 'tint-review/background', 4.5],
  ['tint-danger-foreground', 'tint-danger/background', 4.5],
  ['tint-branch-foreground', 'tint-branch/background', 4.5],
  ['grabber', 'background', 3],
];

const surface = (bg: string, mode: Mode): string => {
  const [top, under] = bg.split('/');
  const colour = value(top!, mode);
  return under ? composite(colour, value(under, mode)) : colour;
};

describe('contrastRatio', () => {
  it('is 21 for white on black and 1 for a colour on itself', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#52525B', '#52525B')).toBeCloseTo(1, 5);
  });

  it('matches the measured zinc-500 on stone-100 (4.43 : 1, the reason for tray-muted-foreground)', () => {
    expect(contrastRatio('#71717A', '#F5F5F4')).toBeCloseTo(4.43, 2);
  });

  it('composites a translucent colour over its background first', () => {
    expect(composite('#00000080', '#FFFFFF')).toBe('#7F7F7F');
    expect(contrastRatio('#00000000', '#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe.each<Mode>(['light', 'dark'])('token contrast, %s', (mode) => {
  it.each(PAIRS)('%s on %s ≥ %d : 1', (fg, bg, min) => {
    const back = surface(bg, mode);
    expect(contrastRatio(composite(value(fg, mode), back), back)).toBeGreaterThanOrEqual(min);
  });

  it.each(['ink', 'ink-hover', 'danger', 'danger-hover'])('on-ink text on both stops of gradient %s ≥ 4.5 : 1', (g) => {
    for (const stop of stops(g, mode)) expect(contrastRatio(value('on-ink', mode), stop)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['ink', 'ink-hover'])('a selected chip’s count (on-ink-muted) on both stops of %s ≥ 4.5 : 1', (g) => {
    for (const stop of stops(g, mode))
      expect(contrastRatio(value('on-ink-muted', mode), stop)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['ink', 'danger'])('the white focus ring on the top stop of %s ≥ 3 : 1', (g) => {
    expect(contrastRatio(value('on-ink', mode), stops(g, mode)[0]!)).toBeGreaterThanOrEqual(3);
  });
});
