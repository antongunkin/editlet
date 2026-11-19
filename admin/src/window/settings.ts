import { useSyncExternalStore } from 'react';

import { postTheme } from './channel';

/** What the editor chooses in Appearance (docs/admin/account.md): the operating system's setting, or one theme. */
export const THEME_CHOICES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number]['id'];

/** The theme the admin is drawn in: what `data-editlet-theme` says. */
export type ThemeId = 'light' | 'dark';

/** Themes removed in the two-theme design system, mapped to the one that replaces them. */
const RETIRED: Record<string, ThemeId> = { sand: 'light', ocean: 'dark', grape: 'dark' };

const STORAGE_KEY = 'editlet:theme';
const LIGHT = '(prefers-color-scheme: light)';

/** The choice made in this session; the source of truth when storage is blocked. */
let remembered: ThemeChoice | null = null;

/** Who draws the choice (Account's radios, Search's Appearance rows): told by `chooseTheme`. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const systemMedia = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia(LIGHT) : null);

/**
 * The saved choice (a retired theme maps to Light or Dark); *System* without one. The key holds `light` or `dark`:
 * *System* is the absence of a choice, as it was before Appearance existed.
 */
export function readChoice(): ThemeChoice {
  if (remembered) return remembered;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    if (saved && saved in RETIRED) return RETIRED[saved]!;
  } catch {
    /* storage blocked */
  }
  return 'system';
}

/** The theme a choice draws: *System* is Light when the system says so, else Dark (the admin's default). */
export function resolveTheme(choice: ThemeChoice): ThemeId {
  if (choice !== 'system') return choice;
  return systemMedia()?.matches ? 'light' : 'dark';
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.editletTheme = theme;
  postTheme(theme);
}

/** Saves a choice (*System* removes the key) and draws it. */
export function chooseTheme(choice: ThemeChoice): void {
  remembered = choice;
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  applyTheme(resolveTheme(choice));
  for (const listener of listeners) listener();
}

/** Call before the first render so the page never flashes the wrong theme; *System* then follows the system's changes. */
export function initTheme(): void {
  applyTheme(resolveTheme(readChoice()));
  systemMedia()?.addEventListener('change', () => {
    if (readChoice() === 'system') applyTheme(resolveTheme('system'));
  });
}

/**
 * The editor's choice and the setter (Appearance). One store: a choice made anywhere (Account, Search) redraws every
 * reader.
 */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readChoice, readChoice);
  return [choice, chooseTheme];
}

/** Forgets the session's choice (tests). */
export function resetThemeChoice(): void {
  remembered = null;
}
