import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { gitBlobSha } from '../../../core/sha';
import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { createAdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';

// Search in GitHub mode (docs/admin/search.md): *Switch branch…* opens the branch picker once the search closes; entry
// files are fetched from the first character typed, not on opening.

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function openHome(fake = createAdminFakeGitHub()) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', ''));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, fake));
  await screen.findByRole('link', { name: /^All content/ });
}

describe('Switch branch… from the search', () => {
  it('is Home’s context action with the active branch; it closes the search and opens Branches', async () => {
    await openHome();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    const list = await within(sheet).findByRole('list', { name: 'Actions' });
    const row = within(list).getByRole('button', { name: /^Switch branch…/ });
    expect(row.textContent).toBe('Switch branch…main');
    fireEvent.click(row);
    expect(await screen.findByRole('dialog', { name: 'Branches' })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull());
  });
});

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', titleField: 'title', fields: { title: { type: 'string', label: 'Title' } } } },
});

describe('titles in the search', () => {
  it('shows the loading line, not Nothing matches, until the title that matches has arrived', async () => {
    const fake = createAdminFakeGitHub({
      files: { 'cms/schema.json': SCHEMA, 'cms/content/post/a.md': '---\ntitle: Tires\n---\n' },
    });
    /** While closed, no blob is answered. */
    let gate = Promise.resolve();
    await openHome({
      ...fake,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body === 'string' && init.body.includes('query Blobs')) await gate;
        return fake.fetch(input, init);
      }) as typeof fetch,
    });
    let release = () => {};
    gate = new Promise<void>((resolve) => (release = resolve));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    const field = within(sheet).getByRole('textbox', { name: 'Search entries and actions' });
    fireEvent.change(field, { target: { value: 'tir' } });
    expect(await within(sheet).findByText('Loading titles: 0 of 1.', { selector: 'p' })).toBeDefined();
    expect(within(sheet).queryByText(/^Nothing matches “/)).toBeNull();
    expect(sheet.querySelector('output')!.textContent).toBe('Loading titles…');

    release();
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    expect(within(list).getByRole('link').textContent).toBe('TiresPost');
    expect(within(sheet).queryByText(/^Loading titles:/)).toBeNull();
    fireEvent.change(field, { target: { value: 'zzz' } });
    expect(await within(sheet).findByText('Nothing matches “zzz”.')).toBeDefined();
  });

  it('fetches no entry on opening, and every one from the first character typed', async () => {
    // The title shares no word with the address: only a fetched title can match it.
    const entries = ['---\ntitle: Tires\n---\n', '---\ntitle: Saddles\n---\n'];
    const fake = createAdminFakeGitHub({
      files: { 'cms/schema.json': SCHEMA, 'cms/content/post/a.md': entries[0]!, 'cms/content/post/b.md': entries[1]! },
    });
    const shas = await Promise.all(entries.map((text) => gitBlobSha(text)));
    const blobs: string[] = [];
    const answer = fake.graphqlOps.Blobs!;
    fake.graphqlOps.Blobs = (variables, query) => {
      for (const [, sha] of query.matchAll(/object\(oid: "([0-9a-f]+)"\)/g)) if (shas.includes(sha!)) blobs.push(sha!);
      return answer(variables, query);
    };
    await openHome(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    const field = within(sheet).getByRole('textbox', { name: 'Search entries and actions' });
    expect(await within(sheet).findByText(/^Type a title, an address or an action\. 2 entries\./)).toBeDefined();
    fireEvent.change(field, { target: { value: '  ' } });
    // Time for the fingerprints and a batch, had one been asked for.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(blobs).toEqual([]);

    fireEvent.change(field, { target: { value: 'tir' } });
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    expect(within(list).getByRole('link').textContent).toBe('TiresPost');
    expect(blobs.toSorted()).toEqual(shas.toSorted());
  });
});
