import { render, screen, waitFor, within } from '@testing-library/react';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gitBlobSha } from '../../../core/sha';
import { openGitHubCache, type GitHubCache } from '../../../github/cache';
import type { GitHubSourceOptions } from '../../../github/source';
import { withEditletRoute } from '../../../loader/protocol';
import { App } from '../App';
import { tokenSession, writeSession } from '../github/session';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { fixtureFiles } from '../test/fixture';
import { LIVE_CONFIG, siteFetch } from '../test/liveApp';
import { createTestQueryClient } from '../test/render';

// The Content model screen over a GitHub source (a fake GitHub behind it) with a real IndexedDB cache: on a clean site
// the next page load checks every entry from its kept summary and reads no entry blob (docs/core/summary.md).

/** The IndexedDB of the test's browser profile (it stays over a "reload"), and the blobs its caches were asked. */
const disk = vi.hoisted(() => ({
  indexedDB: undefined as IDBFactory | undefined,
  opened: [] as GitHubCache[],
  blobs: [] as string[],
}));

// The workspace makes its source without a cache option, and jsdom has no IndexedDB: each source gets its own
// connection to the one fake database, with its blob reads counted.
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

const LOAD = { timeout: 15_000 };

/** The fixture's entry files, and their blob shas. */
async function entries() {
  const texts = Object.entries(fixtureFiles()).flatMap(([path, content]) =>
    path.startsWith('cms/content/') && path.endsWith('.md') ? [content as string] : [],
  );
  return { count: texts.length, shas: new Set(await Promise.all(texts.map(gitBlobSha))) };
}

/** The fake, and the shas its `Blobs` queries were asked (the network reads). */
function site() {
  const fake = createAdminFakeGitHub();
  const fetched: string[] = [];
  const answer = fake.graphqlOps.Blobs!;
  fake.graphqlOps.Blobs = (variables, query) => {
    for (const match of query.matchAll(/object\(oid: "([0-9a-f]+)"\)/g)) fetched.push(match[1]!);
    return answer(variables, query);
  };
  return { fake, fetched };
}

/** One page load of the admin on the Content model screen, resolved when it has checked every entry. */
async function openModel(fake: AdminFakeGitHub) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'schema'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  const client = createTestQueryClient();
  const view = render(<App fetch={siteFetch(LIVE_CONFIG, fake)} storage={window.localStorage} queryClient={client} />);
  const main = await screen.findByRole('main', {}, LOAD);
  await waitFor(() => expect(within(main).getByText('No problems')).toBeDefined(), LOAD);
  return {
    client,
    close: async () => {
      view.unmount();
      client.clear();
      await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
    },
  };
}

/** How many summaries IndexedDB keeps. */
async function stored(): Promise<number> {
  const db = new Dexie('editlet-github', { indexedDB: disk.indexedDB, IDBKeyRange });
  await db.open();
  const count = await db.table('summaries').count();
  db.close();
  return count;
}

afterEach(async () => {
  await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  disk.blobs.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the Content model screen in GitHub mode', () => {
  it('reads no entry blob after a reload of a clean site', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake, fetched } = site();
    const { count, shas } = await entries();
    const entryReads = () => ({
      cache: disk.blobs.filter((sha) => shas.has(sha)).length,
      network: fetched.filter((sha) => shas.has(sha)).length,
    });

    // Cold: every entry is read once, for its summary, and none is kept parsed.
    const cold = await openModel(fake);
    await waitFor(async () => expect(await stored()).toBe(shas.size), LOAD);
    expect(shas.size).toBe(count);
    expect(entryReads().network).toBe(count);
    expect(cold.client.getQueryCache().findAll({ queryKey: ['file'] })).toEqual([]);
    await cold.close();

    disk.blobs.length = fetched.length = 0;
    const warm = await openModel(fake);
    expect(entryReads()).toEqual({ cache: 0, network: 0 });
    expect(warm.client.getQueryCache().findAll({ queryKey: ['file'] })).toEqual([]);
    await warm.close();
  });
});
