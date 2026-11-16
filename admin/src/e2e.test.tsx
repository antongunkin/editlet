import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalSource } from './source/local';
import { entryActions, renderApp } from './test/render';

import { createDevHandler } from '../../node/devHandler';

const site = join(import.meta.dirname, '../../node/__fixtures__/site');
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The admin against the real dev handler on a temp copy of the fixture site (no network, real disk). */
async function devSite() {
  const root = await mkdtemp(join(tmpdir(), 'editlet-e2e-'));
  temps.push(root);
  await cp(site, root, { recursive: true });
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  return { root, source: createLocalSource({ fetch }) };
}

describe('admin ↔ dev API end to end', () => {
  it('opens an entry, edits it, reviews the diff, saves, and the file on disk changes', async () => {
    const { root, source } = await devSite();
    const file = join(root, 'cms/content/post/hello-world.md');
    renderApp({ source, route: 'post/hello-world' });

    const main = screen.getByRole('main');
    const title = (await within(main).findByLabelText(/^Title/)) as HTMLInputElement;
    expect(title.value).toBe('Hello world');
    const save = entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(title, { target: { value: 'Hello e2e' } });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByRole('region', { name: 'Title' });
    expect(within(row).getByText('Hello world')).toBeDefined();
    expect(within(row).getByText('Hello e2e')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await readFile(file, 'utf8')).toContain('title: Hello e2e'));
    const text = await readFile(file, 'utf8');
    expect(text).toContain('author: author/jane');
    expect(text).toContain('Hello!');
    // After the save the form takes the new file as its baseline: nothing left to save.
    await waitFor(() =>
      expect((entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true),
    );
  });
});
