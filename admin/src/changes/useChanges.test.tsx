import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { changesStore, CHANGES_CHANNEL, localScope, setLocalChangesCache, type ChangesMessage } from './store';
import { deriveEntries, useChanges } from './useChanges';

import { parseSchemaText } from '../../../core/schema';
import { createMemorySource, type FileRef } from '../../../core/source';
import { createMemoryCache, type PendingChange } from '../../../github';
import { SourceProvider } from '../source/context';
import { createTestQueryClient, fixtureFiles } from '../test/render';

const schemaText = fixtureFiles()['cms/schema.json'] as string;
const schema = parseSchemaText(schemaText, 'cms/schema.json');

const POST = 'cms/content/post/hello-world.md';
const file = (fm: string, body = '') => `---\n${fm}\n---\n${body}`;
const row = (change: Partial<PendingChange> & { path: string }): PendingChange => ({
  content: null,
  sha: null,
  updatedAt: 1,
  ...change,
});
const listing = (...refs: [string, string][]): FileRef[] => refs.map(([path, sha]) => ({ path, sha }));

describe('deriveEntries', () => {
  it('diffs a row against its base and takes the unsaved title', () => {
    const [entry] = deriveEntries(
      schema,
      [row({ path: POST, sha: 's1', base: file('title: Hello'), content: file('title: Hello again', 'New body') })],
      listing([POST, 's1']),
    );
    expect(entry).toMatchObject({
      ref: 'post/hello-world',
      collection: 'post',
      slug: 'hello-world',
      title: 'Hello again',
      isNew: false,
      revertable: true,
      blocked: null,
    });
    expect(entry!.rows.map((r) => [r.key, r.before, r.after])).toEqual([
      ['title', 'Hello', 'Hello again'],
      ['body', '', 'New body'],
    ]);
  });

  it('marks a conflict, a taken address and a deleted file from the listing; nothing while it loads', () => {
    const rows = [
      row({ path: POST, sha: 'old', base: file('title: A'), content: file('title: B') }),
      row({ path: 'cms/content/post/new.md', sha: null, base: null, content: file('title: New') }),
      row({ path: 'cms/content/author/gone.md', sha: 'g', base: file('name: G'), content: file('name: H') }),
    ];
    const blocked = (files: FileRef[] | undefined) => deriveEntries(schema, rows, files).map((e) => e.blocked);
    expect(blocked(listing([POST, 'newer'], ['cms/content/post/new.md', 'x']))).toEqual([
      'conflict',
      'taken',
      'deleted',
    ]);
    expect(blocked(undefined)).toEqual([null, null, null]);
    const fresh = deriveEntries(schema, rows, listing([POST, 'old'], ['cms/content/author/gone.md', 'g']));
    expect(fresh.map((e) => e.blocked)).toEqual([null, null, null]);
    expect(fresh[1]).toMatchObject({ isNew: true, revertable: false, title: 'New' });
    expect(fresh[1]!.rows.map((r) => r.key)).toEqual(['title']);
  });

  it('validates against the listing plus the buffered new entries and images', () => {
    const rows = [
      row({
        path: POST,
        sha: 's',
        base: file('title: A'),
        content: file('title: A\nauthor: author/dana\nfeaturedImage:\n  src: ./hello-world/new.png\n  alt: x'),
      }),
      row({ path: 'cms/content/author/dana.md', sha: null, base: null, content: file('name: Dana') }),
      row({ path: 'cms/content/post/hello-world/new.png', content: new Uint8Array([1]) }),
    ];
    const [post] = deriveEntries(schema, rows, listing([POST, 's']));
    expect(post!.issues).toEqual([]);
    expect(post!.blocked).toBeNull();
    const [alone] = deriveEntries(schema, rows.slice(0, 1), listing([POST, 's']));
    expect(alone!.blocked).toBe('problems');
    expect(alone!.issues.map((i) => i.path).toSorted()).toEqual(['author', 'featuredImage.src']);
  });

  it('a required field emptied is a problem', () => {
    const [entry] = deriveEntries(
      schema,
      [row({ path: POST, sha: 's', base: file('title: A'), content: file('title: ""') })],
      listing([POST, 's']),
    );
    expect(entry!.blocked).toBe('problems');
  });

  it('shows keys that left the schema as unknown rows, not revertable by kind', () => {
    const [entry] = deriveEntries(
      schema,
      [row({ path: POST, sha: 's', base: file('title: A\nsubtitle: Old'), content: file('title: A\nsubtitle: New') })],
      listing([POST, 's']),
    );
    expect(entry!.rows).toMatchObject([{ key: 'subtitle', type: 'unknown', before: 'Old', after: 'New' }]);
  });

  it('a row of a newer Editlet is listed, blocked, and not read', () => {
    const [entry] = deriveEntries(
      schema,
      [row({ path: POST, sha: 's', base: file('title: A'), content: '???', v: 2 })],
      listing([POST, 's']),
    );
    expect(entry).toMatchObject({ blocked: 'newer-admin', revertable: false, rows: [], after: null, title: 'A' });
  });

  it('skips image rows and files of no collection', () => {
    expect(deriveEntries(schema, [row({ path: 'cms/content/post/x.png', content: new Uint8Array() })], [])).toEqual([]);
  });
});

function Count() {
  const changes = useChanges();
  return (
    <p>
      {changes.ready
        ? `${changes.entries.length} entries, ${changes.count} changes, ${changes.images.length} images`
        : 'Loading'}
    </p>
  );
}

describe('useChanges', () => {
  it('reads the dev scope, follows this tab’s writes and another tab’s broadcast', async () => {
    const cache = createMemoryCache();
    const queryClient = createTestQueryClient();
    setLocalChangesCache(queryClient, cache);
    render(
      <QueryClientProvider client={queryClient}>
        <SourceProvider source={createMemorySource(fixtureFiles())}>
          <Count />
        </SourceProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('0 entries, 0 changes, 0 images');
    // No dev server here: the git state fails, so the scope is the default project without a branch.
    const store = changesStore(cache, localScope('default', null));
    await store.writeEntry({ path: POST, sha: 'x', base: file('title: A'), content: file('title: B') }, [
      { path: 'cms/content/post/hello-world/a.png', content: new Uint8Array([1]), sha: null },
    ]);
    await screen.findByText('1 entries, 1 changes, 1 images');

    // Another tab writes straight into the shared database and posts on the channel.
    await cache
      .pending(store.scope)
      .put({ path: 'cms/content/author/jane.md', sha: null, base: null, content: file('name: J') });
    const other = new BroadcastChannel(CHANGES_CHANNEL);
    const message: ChangesMessage = { scope: store.scope, paths: ['cms/content/author/jane.md'], tab: 'other' };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel has no target origin
    other.postMessage(message);
    await waitFor(() => expect(screen.getByText('2 entries, 2 changes, 1 images')).toBeDefined());
    other.close();
  });
});
