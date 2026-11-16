import { useCallback, useState } from 'react';

export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const;

/** Themes removed in the two-theme design system, mapped to the one that replaces them. */
const RETIRED: Record<string, ThemeId> = { sand: 'light', ocean: 'dark', grape: 'dark' };

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'editlet:theme';

/** The saved theme (a retired one maps to Light or Dark); else the system preference. */
export function readTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const found = THEMES.find((t) => t.id === saved);
    if (found) return found.id;
    if (saved && saved in RETIRED) return RETIRED[saved]!;
  } catch {
    /* storage blocked */
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.editletTheme = theme;
}

/** Call before the first render so the page never flashes the wrong theme. */
export function initTheme(): void {
  applyTheme(readTheme());
}

export function useTheme(): [ThemeId, (theme: ThemeId) => void] {
  const [theme, setTheme] = useState(readTheme);
  const choose = useCallback((next: ThemeId) => {
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked: the theme lasts until reload */
    }
  }, []);
  return [theme, choose];
}
