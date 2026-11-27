import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditletError } from '../../../core/issues';
import { gitBlobSha } from '../../../core/sha';
import { createMemorySource, type ContentSource, type FileVersion } from '../../../core/source';
import { entryScreen, fixtureFiles, moreAction, renderApp, setField, sheet, sheetElement } from '../test/render';

// A modal opened from the entry's ⋯ returns the focus to ⋯ when it closes (`finalFocus`, docs/admin/ui.md, Parts): by
// name, because on Safari a tapped button is not focused, and "back to what had the focus" finds nothing. A tap does not
// focus in jsdom either (`fireEvent.click`), which is the WebKit path; each case also runs with ⋯ focused first, as on
// Chrome. History's version returns to the row that opened it.

const PATH = 'cms/content/post/hello-world.md';
const OLD = '---\ntitle: Hello, old world\nauthor: author/jane\n---\nOld body.\n';

afterEach(() => vi.restoreAllMocks());

async function sourceWithHistory(): Promise<ContentSource> {
  const source = createMemorySource(fixtureFiles());
  const nowSha = (await source.listFiles()).find((f) => f.path === PATH)!.sha;
  const base = { actor: { name: 'Dana Kowalczyk' }, date: '2026-11-19T10:00:00Z' };
  const versions: FileVersion[] = [
    { ...base, commit: '2'.repeat(40), sha: nowSha, message: 'Say hello' },
    { ...base, commit: '1'.repeat(40), sha: await gitBlobSha(new TextEncoder().encode(OLD)), message: 'Create post' },
  ];
  source.listVersions = vi.fn(async () => versions);
  source.readVersion = vi.fn(async (path: string, commit: string) => {
    if (commit === '1'.repeat(40)) return new TextEncoder().encode(OLD);
    if (commit === '2'.repeat(40)) return source.readFile(path);
    throw new EditletError([{ file: path, path: '', message: 'Not found' }]);
  });
  return source;
}

const moreButton = () => within(entryScreen()).getByRole('button', { name: 'More actions' });
const gone = (role: 'dialog' | 'alertdialog', name: string | RegExp) =>
  waitFor(() => expect(screen.queryByRole(role, { name })).toBeNull());
const focusOn = (el: HTMLElement) => waitFor(() => expect(document.activeElement).toBe(el));

type Case = {
  name: string;
  /** Needs a changed title first (Discard is only offered with edits). */
  dirty?: boolean;
  /** Opens the modal from ⋯, closes it, and resolves to the element that must have the focus then. */
  run(more: HTMLElement): Promise<HTMLElement>;
};

const CASES: Case[] = [
  {
    name: 'Details, Escape',
    async run(more) {
      await moreAction('Details');
      fireEvent.keyDown(await sheetElement('Details'), { key: 'Escape' });
      await gone('dialog', 'Details');
      return more;
    },
  },
  {
    name: 'Details, ×',
    async run(more) {
      await moreAction('Details');
      fireEvent.click(within(await sheetElement('Details')).getByRole('button', { name: 'Close' }));
      await gone('dialog', 'Details');
      return more;
    },
  },
  {
    name: 'History → version → Restore',
    async run(more) {
      await moreAction('History');
      const history = await sheet('History');
      const list = await history.findByRole('list', { name: 'Versions' });
      fireEvent.click(within(list).getByRole('button', { name: /Create post/ }));
      const version = await sheetElement(/ago|Nov 19/);
      await within(version).findByRole('region', { name: 'Title' });
      fireEvent.click(within(version).getByRole('button', { name: 'Restore this version' }));
      await gone('dialog', 'History');
      return more;
    },
  },
  {
    name: 'History → version → back: the version’s row, History stays',
    async run() {
      await moreAction('History');
      const history = await sheet('History');
      const list = await history.findByRole('list', { name: 'Versions' });
      const row = within(list).getByRole('button', { name: /Create post/ });
      fireEvent.click(row);
      const version = await sheetElement(/ago|Nov 19/);
      fireEvent.keyDown(version, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /ago|Nov 19/ })).toBeNull());
      expect(screen.getByRole('dialog', { name: 'History' })).toBeDefined();
      return row;
    },
  },
  {
    name: 'Discard, Cancel',
    dirty: true,
    async run(more) {
      await moreAction('Discard changes');
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      await gone('alertdialog', /Discard/);
      return more;
    },
  },
  {
    name: 'Discard, Discard',
    dirty: true,
    async run(more) {
      await moreAction('Discard changes');
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
      await gone('alertdialog', /Discard/);
      return more;
    },
  },
  {
    name: 'Rename…, Cancel',
    async run(more) {
      await moreAction(/^Rename/);
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      await gone('alertdialog', /Rename/);
      return more;
    },
  },
  {
    name: 'Delete…, Cancel',
    async run(more) {
      await moreAction(/^Delete/);
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      await gone('alertdialog', /Delete/);
      return more;
    },
  },
  {
    name: 'Set as draft',
    async run(more) {
      await moreAction(/^Set as draft/);
      await waitFor(() => expect(document.querySelector('[data-slot="action-sheet"]')).toBeNull());
      return more;
    },
  },
];

describe('focus after ⋯', () => {
  describe.each([
    ['⋯ not focused (the tap on Safari)', false],
    ['⋯ focused (the click on Chrome)', true],
  ])('%s', (_, focusFirst) => {
    it.each(CASES)('$name', async (item) => {
      renderApp({ route: 'post/hello-world', source: await sourceWithHistory() });
      await screen.findByRole('button', { name: /^Title/ });
      if (item.dirty) await setField('Title', 'Changed title');
      const more = moreButton();
      if (focusFirst) more.focus();
      const expected = await item.run(more);
      await focusOn(expected);
    });
  });
});
