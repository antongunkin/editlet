import { defineConfig } from 'tsdown';

import { BROWSER_TARGETS } from './browsers.ts';

/** Public entry points; each maps to `dist/<entry>.js` + `.d.ts` (see `exports` in package.json). */
const ENTRIES = [
  'core/index',
  'node/index',
  'auth/handler',
  'auth/client',
  'auth/protocol',
  'github/index',
  'loader/index',
  'loader/protocol',
  'astro/index',
  'astro/content',
  'next/index',
  'next/config',
  'next/preview',
];

export default defineConfig({
  entry: Object.fromEntries(ENTRIES.map((entry) => [entry, `${entry}.ts`])),
  // One output file per source module, so dist/ mirrors the source tree: keeps `'use client'` on
  // dist/next/EditletLoader.js and keeps the dev-API code out of shared chunks.
  unbundle: true,
  // Rolldown warns that it may drop `'use client'`; unbundled output keeps it on dist/next/EditletLoader.js.
  suppressWarnings: /"use client" in "next\/EditletLoader\.tsx" may not be preserved/,
  format: 'esm',
  platform: 'node',
  // Node for the server modules, the browsers for the ones that run in the page (loader, auth/client, EditletLoader).
  target: ['node22', ...BROWSER_TARGETS],
  fixedExtension: false, // .js / .d.ts: the package is "type": "module"
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  clean: true,
  // dependencies and peerDependencies stay external automatically; vite is a dynamic import reached through astro.
  deps: { neverBundle: ['vite'] },
  // TS 7.0 has no JS compiler API: rolldown-plugin-dts runs the native `tsc --emitDeclarationOnly` (tsgo).
  dts: { generator: 'tsgo' },
  // Assets located relative to the code: astro/devServer reads import.meta.dirname + '../admin/dist' | 'stub';
  // next/config takes the package root as dirname(dirname(editlet/next/config)), which is dist/.
  copy: [
    { from: 'admin/dist', to: 'dist/admin', flatten: false },
    { from: 'astro/stub', to: 'dist/astro', flatten: false },
    { from: 'next/stub', to: 'dist/next', flatten: false },
  ],
});
