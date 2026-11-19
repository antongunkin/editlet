/**
 * design/tokens.json → the admin's Tailwind theme (spec 2026-11-18, decision 9). One source for the design scripts
 * (design/figcraft/*.py) and the admin:
 *   npm run design:tokens              write src/ui/tokens/theme.css, src/ui/tokens/tokens.ts and
 *                                      src/ui/primitives/icons.ts
 *   npm run design:tokens -- --check   exit 1 when the committed files differ from what tokens.json gives (in `checks`)
 *
 * theme.css: colour variables with shadcn's names on `:root` / `[data-editlet-theme]` (Light, Dark), mapped into
 * Tailwind with `@theme inline`; shadows (`--elevation-<name>`) and gradients (`--gradient-<name>`) as variables with a
 * Light and a Dark value each (a `{color.x}` reference becomes `var(--x)`, so it follows the theme too); the theme's
 * `--shadow-<name>` is `var(--elevation-<name>)`, so `shadow-<name>` switches with the theme (Tailwind would inline a
 * literal value); `@theme` reset to these tokens only, so no off-scale utility exists; a `bg-gradient-<name>`
 * utility per gradient. tokens.ts: the same values as data, for the contrast tests. icons.ts: the icon paths
 * (Lucide, 24 grid) as `ICONS` and `IconName`, drawn by `Icon` (src/ui/primitives/icon.tsx).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Color {
  $type: 'color';
  $value: string;
  $description?: string;
  $extensions: { editlet: { dark: string } };
}
interface ShadowLayer {
  color: string;
  offsetX: string;
  offsetY: string;
  blur: string;
  spread: string;
  inset: boolean;
}
interface Stop {
  color: string;
  position: number;
}
export interface TokensJson {
  color: Record<string, Color>;
  shadow: Record<string, { $type: 'shadow'; $value: ShadowLayer[]; $extensions: { editlet: { dark: ShadowLayer[] } } }>;
  gradient: Record<string, { $type: 'gradient'; $value: Stop[]; $extensions: { editlet: { dark: Stop[] } } }>;
  scale: {
    spacing: string;
    text: Record<string, [size: number, lineHeight: number]>;
    weight: Record<string, number>;
    radius: Record<string, number>;
    /** Container sizes in px: `--container-<name>`, read by the `@container` variants of app.css (`wide:`). */
    container: Record<string, number>;
    motion: Record<string, [duration: string, easing: string]>;
  };
  icon: Record<string, string>;
}

const HEADER =
  '/* Generated from design/tokens.json by packages/editlet/admin/scripts/tokens.ts (npm run design:tokens). Do not edit. */';
// The system stacks the admin has always used: no web fonts (CLAUDE.md, proposal §14.8).
const FONT_SANS =
  "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";
const FONT_MONO = "ui-monospace, sfmono-regular, menlo, monaco, consolas, 'Liberation Mono', monospace";

const rem = (px: number) => `${px / 16}rem`;
const px0 = (v: string) => (v === '0px' ? '0' : v);

/** A colour of a shadow or gradient: a literal, or `{color.x}` as the theme variable `var(--x)` (`raw`: its value). */
function colour(c: string, t: TokensJson, mode?: 'light' | 'dark'): string {
  const ref = /^\{color\.([a-z0-9-]+)\}$/.exec(c);
  if (!ref) return c;
  const token = t.color[ref[1]!];
  if (!token) throw new Error(`tokens.json: unknown colour reference ${c}`);
  if (!mode) return `var(--${ref[1]})`;
  return mode === 'light' ? token.$value : token.$extensions.editlet.dark;
}

const shadow = (layers: ShadowLayer[], t: TokensJson, mode?: 'light' | 'dark') =>
  layers
    .map((l) =>
      [l.inset ? 'inset' : '', px0(l.offsetX), px0(l.offsetY), px0(l.blur), px0(l.spread), colour(l.color, t, mode)]
        .filter(Boolean)
        .join(' '),
    )
    .join(', ');

const gradient = (stops: Stop[], t: TokensJson, mode?: 'light' | 'dark') =>
  `linear-gradient(${stops.map((s) => colour(s.color, t, mode)).join(', ')})`;

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`;
const pair = (l: string, d: string) => `{ light: '${l}', dark: '${d}' }`;
const key = (n: string) => (/^[a-z][a-z0-9]*$/.test(n) ? n : `'${n}'`);
const entries = (rows: [string, string][]) => rows.map(([n, v]) => `    ${key(n)}: ${v},`).join('\n');

export function render(t: TokensJson): { css: string; ts: string; icons: string } {
  const colors = Object.entries(t.color);

  const light = [
    ...colors.map(([n, c]) => `--${n}: ${c.$value};`),
    ...Object.entries(t.shadow).map(([n, sh]) => `--elevation-${n}: ${shadow(sh.$value, t)};`),
    ...Object.entries(t.gradient).map(([n, g]) => `--gradient-${n}: ${gradient(g.$value, t)};`),
  ];
  const dark = [
    ...colors.map(([n, c]) => `--${n}: ${c.$extensions.editlet.dark};`),
    ...Object.entries(t.shadow).map(([n, sh]) => `--elevation-${n}: ${shadow(sh.$extensions.editlet.dark, t)};`),
    ...Object.entries(t.gradient).map(([n, g]) => `--gradient-${n}: ${gradient(g.$extensions.editlet.dark, t)};`),
  ];
  const inline = colors.map(([n]) => `--color-${n}: var(--${n});`);
  const s = t.scale;
  const theme = [
    '--*: initial;',
    `--spacing: ${s.spacing};`,
    `--font-sans: ${FONT_SANS};`,
    `--font-mono: ${FONT_MONO};`,
    ...Object.entries(s.text).flatMap(([n, [size, lh]]) => [
      `--text-${n}: ${rem(size)};`,
      `--text-${n}--line-height: calc(${lh} / ${size});`,
    ]),
    ...Object.entries(s.weight).map(([n, w]) => `--font-weight-${n}: ${w};`),
    ...Object.entries(s.radius).map(([n, r]) => `--radius-${n}: ${rem(r)};`),
    ...Object.entries(s.container).map(([n, w]) => `--container-${n}: ${rem(w)};`),
    ...Object.keys(t.shadow).map((n) => `--shadow-${n}: var(--elevation-${n});`),
    ...Object.entries(s.motion).flatMap(([n, [d, e]]) => [`--ease-${n}: ${e};`, `--duration-${n}: ${d};`]),
    '--breakpoint-sm: 40rem;',
    '--breakpoint-md: 48rem;',
  ];
  const utilities = Object.keys(t.gradient).map(
    (n) => `@utility bg-gradient-${n} {\n  background-image: var(--gradient-${n});\n}`,
  );
  const css = [
    HEADER,
    block(":root,\n[data-editlet-theme='light']", light),
    block("[data-editlet-theme='dark']", dark),
    // The reset (`--*: initial`) first: it clears every theme variable declared before it, the colours included.
    block('@theme', theme),
    block('@theme inline', inline),
    ...utilities,
  ].join('\n\n');

  const ts = [
    '// Generated from design/tokens.json by packages/editlet/admin/scripts/tokens.ts (npm run design:tokens). Do not edit.',
    'export const TOKENS = {',
    '  color: {',
    entries(colors.map(([n, c]) => [n, pair(c.$value, c.$extensions.editlet.dark)])),
    '  },',
    '  shadow: {',
    entries(
      Object.entries(t.shadow).map(([n, sh]) => [
        n,
        pair(shadow(sh.$value, t, 'light'), shadow(sh.$extensions.editlet.dark, t, 'dark')),
      ]),
    ),
    '  },',
    '  gradient: {',
    entries(
      Object.entries(t.gradient).map(([n, g]) => [
        n,
        pair(gradient(g.$value, t, 'light'), gradient(g.$extensions.editlet.dark, t, 'dark')),
      ]),
    ),
    '  },',
    '} as const;',
  ].join('\n');

  const icons = [
    '// Generated from design/tokens.json by packages/editlet/admin/scripts/tokens.ts (npm run design:tokens). Do not edit.',
    'export const ICONS = {',
    ...Object.entries(t.icon).map(([n, d]) => `  ${key(n)}: '${d}',`),
    '} as const;',
    '',
    'export type IconName = keyof typeof ICONS;',
  ].join('\n');

  return { css: `${css}\n`, ts: `${ts}\n`, icons: `${icons}\n` };
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DEFAULT_PATHS = {
  json: here('../../../../design/tokens.json'),
  css: here('../src/ui/tokens/theme.css'),
  ts: here('../src/ui/tokens/tokens.ts'),
  icons: here('../src/ui/primitives/icons.ts'),
};

/** Writes the files, or with `--check` compares them. Returns the exit code. */
export async function main(argv: string[], paths: typeof DEFAULT_PATHS = DEFAULT_PATHS): Promise<number> {
  const out = render(JSON.parse(readFileSync(paths.json, 'utf8')) as TokensJson);
  const files: [string, string][] = [
    [paths.css, out.css],
    [paths.ts, out.ts],
    [paths.icons, out.icons],
  ];
  if (!argv.includes('--check')) {
    for (const [path, text] of files) writeFileSync(path, text);
    return 0;
  }
  const stale = files.filter(([path, text]) => {
    try {
      return readFileSync(path, 'utf8') !== text;
    } catch {
      return true;
    }
  });
  // oxlint-disable-next-line no-console -- a CLI's own report
  for (const [path] of stale) console.error(`${path} is out of date: run npm run design:tokens`);
  return stale.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
