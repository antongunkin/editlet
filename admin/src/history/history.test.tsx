import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { historyItems, versionWhen } from './EntryHistory';

import { EditletError } from '../../../core/issues';
import { gitBlobSha } from '../../../core/sha';
import { createMemorySource, type ContentSource, type FileVersion } from '../../../core/source';
import type { SourceChange } from '../source/local';
import {
  findCta,
  fixtureFiles,
  moreAction,
  moreActions,
  renderApp,
  rowText,
  saveReview,
  sheet,
  sheetElement,
} from '../test/render';

const PATH = 'cms/content/post/hello-world.md';
const OLD = '---\ntitle: Hello, old world\nauthor: author/jane\n---\nOld body.\n';
const NOW = Date.parse('2026-11-19T12:00:00Z');

const version = (over: Partial<FileVersion>): FileVersion => ({
  commit: 'a'.repeat(40),
  sha: 'b'.repeat(40),
  actor: { name: 'Dana Kowalczyk' },
  date: '2026-11-19T10:00:00Z',
  message: 'Update tires post',
  ...over,
});

describe('historyItems', () => {
  it('marks the version whose blob is the loaded file as current, and a deletion as deleted', () => {
    const items = historyItems(
      [
        version({ commit: '3'.repeat(40), sha: 'cur' }),
        version({ commit: '2'.repeat(40), sha: null, message: 'Remove' }),
        version({
          commit: '1'.repeat(40),
          sha: 'old',
          actor: { name: 'Mo', login: 'mo' },
          date: '2026-11-14T12:00:00Z',
        }),
      ],
      'cur',
      'github',
      NOW,
    );
    expect(items.map((i) => [i.title, i.sub, !!i.current, !!i.deleted])).toEqual([
      ['Update tires post', 'Dana K · 2h ago · current', true, false],
      ['Remove', 'Dana K · 2h ago · deleted', false, true],
      ['Update tires post', 'mo · 5d ago', false, false],
    ]);
  });

  it('adds a Not committed row in dev mode when no commit has the file on disk', () => {
    const items = historyItems([version({ sha: 'old' })], 'disk-sha', 'local', NOW);
    expect(items[0]).toMatchObject({ key: 'disk', title: 'Not committed', current: true });
    expect(items[1]!.current).toBe(false);
    expect(historyItems([version({ sha: 'old' })], 'disk-sha', 'github', NOW)).toHaveLength(1);
  });
});

describe('versionWhen', () => {
  it('reads like the design: 5 days ago, 2 hours ago, then the date', () => {
    expect(versionWhen('2026-11-14T12:00:00Z', NOW)).toBe('5 days ago');
    expect(versionWhen('2026-11-19T10:00:00Z', NOW)).toBe('2 hours ago');
    expect(versionWhen('2026-11-18T11:00:00Z', NOW)).toBe('Yesterday');
    expect(versionWhen('2026-10-02T09:00:00Z', NOW)).toBe('Oct 2, 2026');
  });
});

/** The memory source with two versions of the post: the file as it is now, and OLD. */
async function sourceWithHistory() {
  const files = fixtureFiles();
  const source: ContentSource = createMemorySource(files);
  const nowSha = (await source.listFiles()).find((f) => f.path === PATH)!.sha;
  const versions: FileVersion[] = [
    version({ commit: '2'.repeat(40), sha: nowSha, message: 'Say hello' }),
    version({
      commit: '1'.repeat(40),
      sha: await gitBlobSha(new TextEncoder().encode(OLD)),
      message: 'Create post',
      actor: { name: 'Mo Haddad' },
      date: '2026-11-01T09:00:00Z',
    }),
  ];
  source.listVersions = vi.fn(async () => versions);
  source.readVersion = vi.fn(async (path: string, commit: string) => {
    if (commit === '1'.repeat(40)) return new TextEncoder().encode(OLD);
    if (commit === '2'.repeat(40)) return source.readFile(path);
    throw new EditletError([{ file: path, path: '', message: 'Not found' }]);
  });
  return source;
}

afterEach(() => vi.restoreAllMocks());

describe('Entry ⋯ → History', () => {
  it('lists the versions, opens one with its diff, and Restore makes it an unsaved edit that Save writes', async () => {
    const source = await sourceWithHistory();
    const commit = vi.spyOn(source, 'commit');
    renderApp({ route: 'post/hello-world', source });
    await screen.findByRole('button', { name: /^Title/ });

    await moreAction('History');
    const history = await sheet('History');
    const list = await history.findByRole('list', { name: 'Versions' });
    expect(within(list).getByText(/· current$/)).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /Say hello/ })).toBeNull();

    fireEvent.click(within(list).getByRole('button', { name: /Create post/ }));
    const versionSheet = await sheetElement(/ago|Nov 1, 2026/);
    const title = await within(versionSheet).findByRole('region', { name: 'Title' });
    expect(title.textContent).toContain('Hello, old world');
    expect(title.textContent).toContain('Hello world');
    expect(source.readVersion).toHaveBeenCalledWith(PATH, '1'.repeat(40));

    await act(async () => fireEvent.click(within(versionSheet).getByRole('button', { name: 'Restore this version' })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'History' })).toBeNull());
    expect(rowText('Title')).toContain('Hello, old world');
    fireEvent.click(await findCta(/^Save \d changes?$/));
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalled());
    const [changes] = commit.mock.calls[0] as [SourceChange[], string];
    expect(changes[0]!.content).toContain('title: Hello, old world');
    expect(changes[0]!.content).toContain('Old body.');
  });

  it('is not offered on a source without versions', async () => {
    renderApp({ route: 'post/hello-world', files: fixtureFiles() });
    await screen.findByRole('button', { name: /^Title/ });
    const actions = await moreActions();
    expect(actions.queryByRole('button', { name: /^History/ })).toBeNull();
  });

  it('shows the error when a version does not read, with no Restore', async () => {
    const source = await sourceWithHistory();
    source.readVersion = vi.fn(async () => {
      throw new EditletError([{ path: '', message: 'Frontmatter is not closed with a "---" line' }]);
    });
    renderApp({ route: 'post/hello-world', source });
    await screen.findByRole('button', { name: /^Title/ });
    await moreAction('History');
    const list = await (await sheet('History')).findByRole('list', { name: 'Versions' });
    fireEvent.click(within(list).getByRole('button', { name: /Create post/ }));
    const versionSheet = await sheetElement(/ago|Nov 1, 2026/);
    await within(versionSheet).findByText(/This version can't be read/);
    expect(within(versionSheet).queryByRole('button', { name: 'Restore this version' })).toBeNull();
  });
});
