import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetThemeChoice } from './settings';

import { tokenSession, writeSession } from '../github/session';
import { createAdminFakeGitHub } from '../test/fakeGitHub';
import { fixtureFiles } from '../test/fixture';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { HOME_LOADED, renderApp } from '../test/render';

// The account button and its sheet (docs/admin/account.md): Appearance everywhere, the account only in GitHub mode.

const KEY = 'editlet:theme';
const theme = () => document.documentElement.dataset.editletTheme;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetThemeChoice();
  delete document.documentElement.dataset.editletTheme;
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const tab = (sheet: HTMLElement, name: string) => within(sheet).getByRole('tab', { name });

describe('Appearance in dev mode', () => {
  const open = async () => {
    renderApp();
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    return await screen.findByRole('dialog', { name: 'Appearance' });
  };

  it('has no account: Local files and the choice, no Sign out, no Reviewers', async () => {
    const sheet = await open();
    expect(within(sheet).getByText('Local files', { selector: 'span' })).toBeDefined();
    expect(within(sheet).getByText('Dev server · edits are written to disk')).toBeDefined();
    expect(
      within(sheet)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['System', 'Light', 'Dark']);
    expect(within(sheet).queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(within(sheet).queryByText('Reviewers')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
  });

  it('shows System selected first; a choice draws at once and is remembered', async () => {
    const sheet = await open();
    expect(tab(sheet, 'System').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tab(sheet, 'Dark'));
    expect(theme()).toBe('dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    fireEvent.click(tab(sheet, 'Light'));
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBe('light');
    fireEvent.click(tab(sheet, 'System'));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(tab(sheet, 'System').getAttribute('aria-selected')).toBe('true');
  });

  it('opens with the saved choice selected', async () => {
    window.localStorage.setItem(KEY, 'dark');
    const sheet = await open();
    expect(tab(sheet, 'Dark').getAttribute('aria-selected')).toBe('true');
    expect(tab(sheet, 'System').getAttribute('aria-selected')).toBe('false');
  });
});

describe('the account in GitHub mode', () => {
  const CODEOWNERS = '*  @acme/admins\n/cms/content/  @acme/editors\n';

  async function open(files: Record<string, string | Uint8Array> = fixtureFiles(), opts: { admin?: boolean } = {}) {
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderLiveApp(siteFetch(LIVE_CONFIG, createAdminFakeGitHub({ files, ...opts })));
    await within(await screen.findByRole('main')).findByRole('link', { name: HOME_LOADED });
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    return await screen.findByRole('dialog', { name: 'Account' });
  }

  it('shows who, the role, Appearance, Reviewers and Sign out; no Appearance button on Home', async () => {
    const sheet = await open({ ...fixtureFiles(), '.github/CODEOWNERS': CODEOWNERS }, { admin: true });
    expect(within(sheet).getByText('o/r')).toBeDefined();
    expect(within(sheet).getByText('octocat')).toBeDefined();
    expect(within(sheet).getByText('Admin')).toBeDefined();
    expect(within(sheet).getAllByRole('tab')).toHaveLength(3);
    const reviewers = await within(sheet).findByRole('list', { name: 'Reviewers' });
    expect(reviewers.textContent).toContain('Needs approval from @acme/editors');
    expect(within(sheet).getByRole('button', { name: 'Sign out' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Appearance' })).toBeNull();
  });

  it('says so when CODEOWNERS names no owner of the content', async () => {
    const sheet = await open({ ...fixtureFiles(), '.github/CODEOWNERS': '# nobody\n' });
    const reviewers = await within(sheet).findByRole('list', { name: 'Reviewers' });
    expect(reviewers.textContent).toContain('No code owners set for content');
  });

  it('says there are no owners when the repository has no CODEOWNERS file', async () => {
    const sheet = await open();
    const reviewers = await within(sheet).findByRole('list', { name: 'Reviewers' });
    expect(reviewers.textContent).toContain('No code owners set for content');
  });

  it('changes Appearance from the account sheet', async () => {
    const sheet = await open();
    fireEvent.click(tab(sheet, 'Light'));
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBe('light');
  });
});
