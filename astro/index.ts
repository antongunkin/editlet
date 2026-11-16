import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { AstroIntegration } from 'astro';

import { adminDir, createDevMiddleware } from './devServer';
import { DEFAULT_SCHEMA_PATH, setAstroState } from './shared';

import {
  ADMIN_CONFIG_FILE,
  buildAdminConfig,
  resolveParam,
  type AdminConfig,
  type AdminConfigOptions,
} from '../admin/config';
import { DEFAULT_ADMIN_URL } from '../loader/protocol';
import { loadProjectSchema } from '../node/fs';

export interface EditletAstroOptions {
  /** Schema file relative to the Astro project root. Default `cms/schema.json`. */
  schemaPath?: string;
  /** Public admin config (`config.json` in the build). Everything here ends up public. */
  admin?: AdminConfigOptions;
}

/**
 * Page script: the loader on the site's query parameter (`editlet` unless `admin.param` or `EDITLET_PARAM` says
 * otherwise), re-synced after every client-side navigation (`<ClientRouter />`).
 */
export function loaderScript(param: string): string {
  return (
    `import { mountEditletLoader } from 'editlet/loader'; const l = mountEditletLoader({ param: ${JSON.stringify(param)} }); ` +
    "document.addEventListener('astro:page-load', () => l.sync());"
  );
}

/** `DEFAULT_ADMIN_URL` without slashes: the build output folder of the admin (`editlet`). */
const ADMIN_OUT_DIR = DEFAULT_ADMIN_URL.replace(/^\/|\/$/g, '');

/** Vite plugin that copies every file of `adminDir()` into the client build as `editlet/<rel>`, plus `config.json`. */
type VitePlugin = NonNullable<import('astro').ViteUserConfig['plugins']>[number];

function adminEmitPlugin(config: AdminConfig): VitePlugin {
  return {
    name: 'editlet:admin',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    async generateBundle() {
      const dir = adminDir();
      const entries = await readdir(dir, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = join(entry.parentPath, entry.name);
        const rel = relative(dir, file).split(sep).join('/');
        this.emitFile({ type: 'asset', fileName: `${ADMIN_OUT_DIR}/${rel}`, source: await readFile(file) });
      }
      this.emitFile({
        type: 'asset',
        fileName: `${ADMIN_OUT_DIR}/${ADMIN_CONFIG_FILE}`,
        source: `${JSON.stringify(config, null, 2)}\n`,
      });
    },
  };
}

/**
 * `.env*` of the project for `mode` (Astro does not load them into `process.env` at config time), with `process.env`
 * on top. Through Astro's own `vite`; without it, `process.env` alone.
 */
async function buildEnv(mode: string, root: string): Promise<Record<string, string | undefined>> {
  try {
    const { loadEnv } = await import('vite');
    return { ...loadEnv(mode, root, ''), ...process.env };
  } catch {
    return process.env;
  }
}

/** Astro integration: the `?editlet` loader on every page, dev file API + admin in `astro dev`, admin folder in the build. */
export default function editlet(options: EditletAstroOptions = {}): AstroIntegration {
  const schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
  let root = process.cwd();
  return {
    name: 'editlet',
    hooks: {
      'astro:config:setup': async ({ command, config, injectScript, addWatchFile, updateConfig }) => {
        root = resolve(fileURLToPath(config.root));
        setAstroState({ root, schemaPath, command });
        const env = await buildEnv(command === 'build' ? 'production' : 'development', root);
        injectScript('page', loaderScript(resolveParam(options.admin, env)));
        addWatchFile(pathToFileURL(join(root, schemaPath)));
        if (command === 'build') {
          const baseBranch = (await loadProjectSchema(root, schemaPath)).git.baseBranch;
          const adminConfig = buildAdminConfig(options.admin, { baseBranch, env });
          updateConfig({ vite: { plugins: [adminEmitPlugin(adminConfig)] } });
        }
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(createDevMiddleware({ root, schemaPath, adminDir: adminDir() }));
      },
    },
  };
}
