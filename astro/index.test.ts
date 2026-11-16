// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminDir } from './devServer';
import editlet, { loaderScript } from './index';
import { getAstroState } from './shared';

const viteEnv = vi.hoisted(() => ({ loadEnv: vi.fn((): Record<string, string> => ({})) }));
vi.mock('vite', async (importOriginal) => ({ ...(await importOriginal<typeof import('vite')>()), ...viteEnv }));

afterEach(() => {
  viteEnv.loadEnv.mockReset().mockReturnValue({});
  delete process.env.CMS_SESSION_MINUTES;
  delete process.env.EDITLET_PARAM;
});

type SetupHook = (options: Record<string, unknown>) => void | Promise<void>;
const siteRoot = fileURLToPath(new URL('../next/__fixtures__/site/', import.meta.url));
interface EmitPlugin {
  name: string;
  apply: string;
  applyToEnvironment: (env: { name: string }) => boolean;
  generateBundle: (this: { emitFile: (file: unknown) => void }) => Promise<void>;
}

async function setup(command: 'dev' | 'build', schemaPath?: string, admin?: Record<string, string | number>) {
  const integration = editlet({ ...(schemaPath ? { schemaPath } : {}), ...(admin ? { admin } : {}) });
  const calls = { injectScript: vi.fn(), addWatchFile: vi.fn(), updateConfig: vi.fn() };
  const hook = integration.hooks['astro:config:setup'] as unknown as SetupHook;
  await hook({ command, config: { root: pathToFileURL(command === 'build' ? siteRoot : '/tmp/site/') }, ...calls });
  return { integration, ...calls };
}

/** The `config.json` the emit plugin of a build setup writes. */
async function configOf(updateConfig: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  const plugin = (updateConfig.mock.calls[0]![0] as { vite: { plugins: EmitPlugin[] } }).vite.plugins[0]!;
  const emitFile = vi.fn();
  await plugin.generateBundle.call({ emitFile });
  const call = emitFile.mock.calls.find(([f]) => (f as { fileName: string }).fileName === 'editlet/config.json');
  return JSON.parse((call![0] as { source: string }).source) as Record<string, unknown>;
}

describe('editlet integration', () => {
  it('records state, injects the loader and watches the schema', async () => {
    const { integration, injectScript, addWatchFile, updateConfig } = await setup('dev', 'content/schema.json');
    expect(integration.name).toBe('editlet');
    expect(getAstroState()).toEqual({ root: '/tmp/site', schemaPath: 'content/schema.json', command: 'dev' });
    expect(injectScript).toHaveBeenCalledWith('page', loaderScript('editlet'));
    expect(loaderScript('editlet')).toBe(
      'import { mountEditletLoader } from \'editlet/loader\'; const l = mountEditletLoader({ param: "editlet" }); ' +
        "document.addEventListener('astro:page-load', () => l.sync());",
    );
    expect(String(addWatchFile.mock.calls[0]?.[0])).toBe('file:///tmp/site/content/schema.json');
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('emits the admin folder into the client build', async () => {
    const { updateConfig } = await setup('build', undefined, { repo: 'acme/site' });
    expect(getAstroState()?.schemaPath).toBe('cms/schema.json');
    const plugin = (updateConfig.mock.calls[0]![0] as { vite: { plugins: EmitPlugin[] } }).vite.plugins[0]!;
    expect(plugin.name).toBe('editlet:admin');
    expect(plugin.apply).toBe('build');
    expect(plugin.applyToEnvironment({ name: 'client' })).toBe(true);
    expect(plugin.applyToEnvironment({ name: 'ssr' })).toBe(false);

    const emitFile = vi.fn();
    await plugin.generateBundle.call({ emitFile });
    const files = (await readdir(adminDir(), { recursive: true, withFileTypes: true })).filter((d) => d.isFile());
    expect(emitFile).toHaveBeenCalledTimes(files.length + 1);
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'editlet/index.html',
      source: await readFile(join(adminDir(), 'index.html')),
    });
    const configCall = emitFile.mock.calls.find(
      ([f]) => (f as { fileName: string }).fileName === 'editlet/config.json',
    );
    expect(JSON.parse((configCall![0] as { source: string }).source)).toEqual({
      github: { owner: 'acme', repo: 'site', baseBranch: 'main' },
    });
  });

  it('build: CMS_SESSION_MINUTES comes from .env (loadEnv); process.env wins', async () => {
    viteEnv.loadEnv.mockReturnValue({ CMS_SESSION_MINUTES: '15' });
    const fromDotEnv = await setup('build', undefined, { repo: 'acme/site' });
    expect(viteEnv.loadEnv).toHaveBeenCalledWith('production', siteRoot.replace(/\/$/, ''), '');
    expect((await configOf(fromDotEnv.updateConfig)).sessionMinutes).toBe(15);

    process.env.CMS_SESSION_MINUTES = '20';
    const fromProcess = await setup('build', undefined, { repo: 'acme/site' });
    expect((await configOf(fromProcess.updateConfig)).sessionMinutes).toBe(20);

    const fromOption = await setup('build', undefined, { repo: 'acme/site', sessionMinutes: 30 });
    expect((await configOf(fromOption.updateConfig)).sessionMinutes).toBe(30);
  });

  it('EDITLET_PARAM (.env or process.env) or admin.param sets the loader parameter and config.json', async () => {
    viteEnv.loadEnv.mockReturnValue({ EDITLET_PARAM: 'cms' });
    const dev = await setup('dev');
    expect(viteEnv.loadEnv).toHaveBeenCalledWith('development', '/tmp/site', '');
    expect(dev.injectScript).toHaveBeenCalledWith('page', loaderScript('cms'));

    const build = await setup('build', undefined, { repo: 'acme/site' });
    expect(build.injectScript).toHaveBeenCalledWith('page', loaderScript('cms'));
    expect((await configOf(build.updateConfig)).param).toBe('cms');

    const fromOption = await setup('build', undefined, { repo: 'acme/site', param: 'edit' });
    expect(fromOption.injectScript).toHaveBeenCalledWith('page', loaderScript('edit'));
    expect((await configOf(fromOption.updateConfig)).param).toBe('edit');

    viteEnv.loadEnv.mockReturnValue({});
    expect(
      (await configOf((await setup('build', undefined, { repo: 'acme/site' })).updateConfig)).param,
    ).toBeUndefined();
  });

  it('adds the dev middleware on server setup', () => {
    const integration = editlet();
    (integration.hooks['astro:config:setup'] as unknown as SetupHook)({
      command: 'dev',
      config: { root: pathToFileURL('/tmp/site/') },
      injectScript: vi.fn(),
      addWatchFile: vi.fn(),
      updateConfig: vi.fn(),
    });
    const use = vi.fn();
    (integration.hooks['astro:server:setup'] as unknown as SetupHook)({ server: { middlewares: { use } } });
    expect(use).toHaveBeenCalledTimes(1);
    expect(typeof use.mock.calls[0]?.[0]).toBe('function');
  });
});
