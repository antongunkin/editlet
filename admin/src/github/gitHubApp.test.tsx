import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tokenSession, writeSession } from './session';

import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { fixtureFiles } from '../test/fixture';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { HOME_LOADED } from '../test/render';

// The live-site gate: access check, then the git style read from the base branch's schema.

const SCHEMA_URL = 'https://api.github.com/repos/o/r/contents/cms/schema.json';

function open(github: AdminFakeGitHub, wrap = (f: typeof fetch) => f) {
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(wrap(siteFetch(LIVE_CONFIG, github)));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('GitHubApp', () => {
  it('shows the Admin role to a repository admin', async () => {
    open(createAdminFakeGitHub({ admin: true }));
    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('link', { name: HOME_LOADED })).toBeDefined();
    // The role is in the account sheet the header's avatar opens.
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(await screen.findByText('Admin')).toBeDefined();
    expect(screen.queryByText('Editor')).toBeNull();
  });

  it.each([
    [
      'without a schema on the base branch',
      () => {
        const { 'cms/schema.json': _, ...rest } = fixtureFiles();
        return rest;
      },
    ],
    ['with a broken schema on the base branch', () => ({ ...fixtureFiles(), 'cms/schema.json': '{' })],
  ])('opens the shell with the default git style %s', async (_, files) => {
    open(createAdminFakeGitHub({ files: files() }));
    expect(await screen.findByRole('main')).toBeDefined();
    expect(screen.queryByText("Can't check your access")).toBeNull();
  });

  it('says it cannot check access when the schema read fails, and Try again reads it again', async () => {
    // The query retries once: both reads fail, then GitHub answers again.
    let failing = true;
    const flaky = (base: typeof fetch) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (href.startsWith(SCHEMA_URL) && failing) {
          return Response.json({ message: 'Server Error' }, { status: 500 });
        }
        return base(input, init);
      }) as typeof fetch;
    open(createAdminFakeGitHub(), flaky);
    expect(await screen.findByText("Can't check your access")).toBeDefined();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const main = await screen.findByRole('main');
    await waitFor(() => expect(within(main).getByRole('link', { name: HOME_LOADED })).toBeDefined());
  });
});
