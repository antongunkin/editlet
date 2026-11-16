import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { mountDevApi } from './dev/devApi';
import { copyFixture } from './dev/fixture';

import { BROWSER_TARGETS } from '../browsers.ts';

const adminRoot = fileURLToPath(new URL('.', import.meta.url));

/** Serve mode only: the dev file API over a temp copy of the site fixture (or `EDITLET_ROOT`). */
function editletDevApi(): Plugin {
  return {
    name: 'editlet-dev-api',
    async configureServer(server) {
      const root = process.env.EDITLET_ROOT ?? (await copyFixture());
      server.config.logger.info(`Editlet content root: ${root}`);
      server.middlewares.use(mountDevApi(root));
    },
  };
}

/**
 * Admin SPA build. `base: './'` keeps every asset URL relative so `dist/` can be served from any
 * path (adapters mount it under their own admin route).
 */
export default defineConfig(({ command }) => ({
  root: adminRoot,
  base: './',
  plugins: [react(), ...(command === 'serve' ? [editletDevApi()] : [])],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // JS syntax and CSS (cssTarget follows it into Lightning CSS) for the oldest supported browsers.
    target: BROWSER_TARGETS,
    rolldownOptions: {
      // preview.js (live-preview overlay) and window.js (floating-window geometry) are injected by the site loader for
      // editors; their URLs must be stable (unhashed).
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        preview: fileURLToPath(new URL('../loader/preview/entry.ts', import.meta.url)),
        window: fileURLToPath(new URL('../loader/window/entry.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (c: { name: string }) =>
          ['preview', 'window'].includes(c.name) ? `${c.name}.js` : 'assets/[name]-[hash].js',
      },
    },
  },
}));
