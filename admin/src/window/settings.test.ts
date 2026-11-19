import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseTheme, initTheme, readChoice, resetThemeChoice, resolveTheme } from './settings';

// Appearance (docs/admin/account.md#appearance): System, Light or Dark; remembered in `editlet:theme`.

const KEY = 'editlet:theme';
const theme = () => document.documentElement.dataset.editletTheme;

/** A `matchMedia` for `(prefers-color-scheme: light)` whose answer a test can change. */
function stubSystem(light: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: light,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => media);
  return (next: boolean) => {
    media.matches = next;
    listeners.forEach((fn) => fn());
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetThemeChoice();
  delete document.documentElement.dataset.editletTheme;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readChoice', () => {
  it('is System without a saved choice', () => {
    expect(readChoice()).toBe('system');
  });

  it('reads Light and Dark, and maps a retired theme to the one that replaces it', () => {
    window.localStorage.setItem(KEY, 'dark');
    expect(readChoice()).toBe('dark');
    window.localStorage.setItem(KEY, 'sand');
    expect(readChoice()).toBe('light');
    window.localStorage.setItem(KEY, 'grape');
    expect(readChoice()).toBe('dark');
    window.localStorage.setItem(KEY, 'nonsense');
    expect(readChoice()).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('draws Light and Dark as chosen, and System as the system says (Dark when it cannot say)', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    stubSystem(true);
    expect(resolveTheme('system')).toBe('light');
    stubSystem(false);
    expect(resolveTheme('system')).toBe('dark');
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('chooseTheme', () => {
  it('draws and saves Light or Dark; System removes the key and draws the system’s theme', () => {
    stubSystem(true);
    chooseTheme('dark');
    expect(theme()).toBe('dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    chooseTheme('system');
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(readChoice()).toBe('system');
  });

  it('keeps the choice for the session when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    chooseTheme('light');
    expect(theme()).toBe('light');
    expect(readChoice()).toBe('light');
  });
});

describe('initTheme', () => {
  it('draws the saved choice before the first render', () => {
    stubSystem(true);
    window.localStorage.setItem(KEY, 'dark');
    initTheme();
    expect(theme()).toBe('dark');
  });

  it('follows the system while the choice is System, and only then', () => {
    const setSystem = stubSystem(true);
    initTheme();
    expect(theme()).toBe('light');
    setSystem(false);
    expect(theme()).toBe('dark');
    chooseTheme('light');
    setSystem(false);
    expect(theme()).toBe('light');
  });
});
