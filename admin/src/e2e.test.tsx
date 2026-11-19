import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalSource } from './source/local';
import {
  closeSheet,
  cta,
  findCta,
  openEntryDiff,
  renderApp,
  reviewCta,
  rowText,
  saveReview,
  setField,
} from './test/render';

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

    await screen.findByRole('button', { name: /^Title/ });
    expect(rowText('Title')).toContain('Hello world');
    expect(cta()).toBeNull();

    await setField('Title', 'Hello e2e');
    fireEvent.click(await findCta('Save 1 change'));

    // The entry's row in Your changes opens its diff: the old title struck through, the new one.
    const diff = await openEntryDiff('Hello e2e');
    const row = diff.getByRole('region', { name: 'Title' });
    expect(within(row).getByText('Hello world')).toBeDefined();
    expect(within(row).getByText('Hello e2e')).toBeDefined();
    await closeSheet();
    expect((await reviewCta()).textContent).toBe('Save 1 change');
    await saveReview();

    await waitFor(async () => expect(await readFile(file, 'utf8')).toContain('title: Hello e2e'));
    const text = await readFile(file, 'utf8');
    expect(text).toContain('author: author/jane');
    expect(text).toContain('Hello!');
    // After the save the form takes the new file as its baseline: nothing left to save.
    await waitFor(() => expect(cta()).toBeNull());
  });
});
