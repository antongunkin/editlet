import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { createAdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';

// Search in GitHub mode (docs/admin/search.md#actions): *Switch branch…* opens the branch picker once the search closes.

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function openHome() {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', ''));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, createAdminFakeGitHub()));
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
