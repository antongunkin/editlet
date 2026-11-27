import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gitBlobSha } from '../../../core/sha';
import type { GitHubCache } from '../../../github/cache';
import { openGitHubCache } from '../../../github/cache';
import type { GitHubSourceOptions } from '../../../github/source';
import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { activeBranchKey } from '../github/workspace';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { fixtureFiles } from '../test/fixture';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';

// The Media screen over a GitHub source with a real IndexedDB cache: the index comes from the kept summaries, and only
// a rewrite reads entry files.

/** The IndexedDB of the test's browser profile (it stays over a "reload"), and the blobs its caches were asked by sha. */
const disk = vi.hoisted(() => ({
  indexedDB: undefined as IDBFactory | undefined,
  opened: [] as GitHubCache[],
  blobs: [] as string[],
}));

// As data/summaries.github.test.tsx: jsdom has no IndexedDB, so each source gets its own connection to the one fake
// database, with its blob reads counted.
vi.mock('../../../github', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../github')>();
  return {
    ...original,
    createGitHubSource: (options: GitHubSourceOptions) => {
      const cache = openGitHubCache({ indexedDB: disk.indexedDB, IDBKeyRange });
      const { getBlobs } = cache;
      cache.getBlobs = (shas) => {
        disk.blobs.push(...shas);
        return getBlobs(shas);
      };
      disk.opened.push(cache);
      return original.createGitHubSource({ ...options, cache });
    },
  };
});

const ONE = 'cms/content/post/one.md';
const TWO = 'cms/content/post/two.md';
const IMAGE = 'cms/content/post/one/a.png';

const files = (): Record<string, string | Uint8Array> => ({
  ...fixtureFiles(),
  [ONE]: '---\ntitle: One\n---\n![Old](one/a.png)\n',
  [TWO]: '---\ntitle: Two\n---\n![Other](two/b.png)\n',
  [IMAGE]: new Uint8Array([1]),
  'cms/content/post/two/b.png': new Uint8Array([2]),
  'cms/content/post/two/unused.png': new Uint8Array([3]),
});

/** The shas of the entry files of `site`, by path. */
async function entryShas(site: Record<string, string | Uint8Array>): Promise<Map<string, string>> {
  const entries = Object.entries(site).filter(([path]) => /^cms\/content\/.+\.md$/.test(path));
  return new Map(await Promise.all(entries.map(async ([path, text]) => [path, await gitBlobSha(text)] as const)));
}

/** The fake, and the shas its `Blobs` queries were asked (the network reads). */
function counted(fake: AdminFakeGitHub) {
  const fetched: string[] = [];
  const answer = fake.graphqlOps.Blobs!;
  fake.graphqlOps.Blobs = (variables, query) => {
    for (const match of query.matchAll(/object\(oid: "([0-9a-f]+)"\)/g)) fetched.push(match[1]!);
    return answer(variables, query);
  };
  return fetched;
}

/** One page load of `?editlet=media`, until the usage index has every entry. */
async function openMedia(fake: AdminFakeGitHub) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'media'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, fake));
  await screen.findByTitle(IMAGE);
  await waitFor(() => expect(screen.queryByRole('button', { name: /Checking…/ })).toBeNull());
}

const close = async () => {
  cleanup();
  await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
};

/** How many summaries IndexedDB keeps. */
async function stored(): Promise<number> {
  const db = new Dexie('editlet-github', { indexedDB: disk.indexedDB, IDBKeyRange });
  await db.open();
  const rows = await db.table('summaries').count();
  db.close();
  return rows;
}

afterEach(async () => {
  await close();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the media index over a GitHub source', () => {
  it('reads no entry blob after a reload, and an alt edit reads only the entry it rewrites', async () => {
    disk.indexedDB = new IDBFactory();
    const site = files();
    const shas = await entryShas(site);
    const all = new Set(shas.values());
    const fake = createAdminFakeGitHub({ files: site });
    const fetched = counted(fake);
    fake.state.refs.set('editlet/a', fake.state.refs.get('main')!);
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/a');
    const reads = () => [...new Set([...disk.blobs, ...fetched].filter((sha) => all.has(sha)))];

    // Cold: every entry is read once, and its summary kept.
    await openMedia(fake);
    expect(reads().toSorted()).toEqual([...all].toSorted());
    await waitFor(async () => expect(await stored()).toBe(all.size));
    await close();

    disk.blobs.length = fetched.length = 0;
    await openMedia(fake);
    expect(reads()).toEqual([]);

    fireEvent.click(screen.getByTitle(IMAGE));
    const main = within(screen.getByRole('main'));
    await main.findByRole('heading', { level: 1, name: 'a.png' });
    expect(reads()).toEqual([]);
    fireEvent.change(main.getByRole('textbox', { name: /^Alt text in one,/ }), { target: { value: 'New' } });
    fireEvent.click(main.getByRole('button', { name: 'Save alt text' }));

    const committed = () =>
      new TextDecoder().decode(
        fake.state.blobs.get(fake.state.commits.get(fake.state.refs.get('editlet/a')!)!.files.get(ONE)!)!,
      );
    await waitFor(() => expect(committed()).toContain('![New](one/a.png)'));
    await main.findByDisplayValue('New');
    expect(reads()).toEqual([shas.get(ONE)]);
  });
});
