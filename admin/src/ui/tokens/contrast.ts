/**
 * WCAG 2 contrast for the token tests (spec 2026-11-18; WCAG 2.2 SC 1.4.3, 1.4.11). Colours are `#RRGGBB` or
 * `#RRGGBBAA`, the spelling of `design/tokens.json`.
 */

function channels(hex: string): [r: number, g: number, b: number, a: number] {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

const hex2 = (v: number) => Math.round(v).toString(16).toUpperCase().padStart(2, '0');

/** `fg` (possibly translucent) drawn over the opaque `bg`, as an opaque `#RRGGBB`. */
export function composite(fg: string, bg: string): string {
  const [r, g, b, a] = channels(fg);
  const [br, bgr, bb] = channels(bg);
  return `#${hex2(r * a + br * (1 - a))}${hex2(g * a + bgr * (1 - a))}${hex2(b * a + bb * (1 - a))}`;
}

/** An sRGB channel (0–255) as linear light. */
function lin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG 2 contrast ratio of two colours, 1–21. A translucent `fg` is composited over `bg` first. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(composite(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
