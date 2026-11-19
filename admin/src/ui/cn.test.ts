import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('joins conditional classes as before (strings, arrays, objects)', () => {
    expect(cn('a', false, null, undefined, ['b', { c: true, d: false }])).toBe('a b c');
  });

  it('keeps classes it does not know untouched (the named utilities of app.css)', () => {
    expect(cn('morph', 'morph-out', 'pill-closing')).toBe('morph morph-out pill-closing');
  });

  it('lets the last of two conflicting utilities win, with the generated theme names', () => {
    expect(cn('shadow-card', 'shadow-raised')).toBe('shadow-raised');
    expect(cn('bg-card', 'bg-background')).toBe('bg-background');
    expect(cn('text-muted-foreground', 'text-tray-muted-foreground')).toBe('text-tray-muted-foreground');
    expect(cn('bg-gradient-ink', 'bg-gradient-danger')).toBe('bg-gradient-danger');
    expect(cn('ease-tab', 'ease-press')).toBe('ease-press');
  });

  it('does not merge different properties that share a prefix', () => {
    expect(cn('text-sm', 'text-muted-foreground')).toBe('text-sm text-muted-foreground');
    expect(cn('bg-card', 'bg-gradient-ink')).toBe('bg-card bg-gradient-ink');
  });
});
