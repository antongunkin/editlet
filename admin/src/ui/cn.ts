import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { TOKENS } from './tokens/tokens';

export type { ClassValue };

/**
 * tailwind-merge knows Tailwind's default theme only; the admin's theme is generated from design/tokens.json
 * (`src/ui/tokens/`), so its names are given here: colours, shadows, easings and the `bg-gradient-*` utilities.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: Object.keys(TOKENS.color),
      shadow: Object.keys(TOKENS.shadow),
      ease: ['modal-in', 'modal-out', 'scrim', 'press', 'release', 'tab', 'hover', 'saved', 'resize', 'reduced'],
    },
    classGroups: {
      'bg-image': [{ 'bg-gradient': Object.keys(TOKENS.gradient) }],
    },
  },
  // Shadow names (`card`, `sunken`) are colour names too: without this, `shadow-card` would be read as a shadow
  // colour. The admin has no shadow-colour utilities (shadow colours are part of the shadow tokens).
  override: {
    classGroups: { 'shadow-color': [{ 'shadow-color': ['none'] }] },
  },
});

/**
 * Joins conditional class names (strings, arrays, `{ class: condition }` objects); of two conflicting Tailwind
 * utilities the last wins. BEM classes pass through unchanged.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
