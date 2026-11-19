import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDevHandler } from '../../../node/devHandler';
import { createLocalSource } from '../source/local';
import { moreAction, renderApp, setField, sheet } from '../test/render';

const survey = join(import.meta.dirname, '../../../__fixtures__/survey');

configure({ asyncUtilTimeout: 10_000 });
const temps: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * The survey fixture with `extra` more options whose follow-up is `question/age` (already used by the section
 * *About you* and the option *18 or older*: 2), so `question/age` is used by `2 + extra` entries in two collections.
 */
async function surveySite(extra: number) {
  const root = await mkdtemp(join(tmpdir(), 'editlet-used-by-'));
  temps.push(root);
  await cp(survey, root, { recursive: true });
  for (let i = 1; i <= extra; i++) {
    const n = String(i).padStart(2, '0');
    await writeFile(
      join(root, `cms/content/option/extra-${n}.md`),
      `---\nlabel: Extra ${n}\nfollowUp: question/age\n---\n`,
    );
  }
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  return createLocalSource({ fetch });
}

const main = () => screen.getByRole('main');
const route = () => new URLSearchParams(window.location.search).get('editlet');
const usedBy = (n: number) => within(main()).findByRole('region', { name: `Used by ${n} entries` });
const inlineLinks = (region: HTMLElement) => within(region).queryAllByRole('link');

describe('Used by', () => {
  it('lists up to six referrers inline, with no row for the sheet', async () => {
    renderApp({ source: await surveySite(4), route: 'question/age' });
    const region = await usedBy(6);
    expect(inlineLinks(region)).toHaveLength(6);
    expect(within(region).queryByRole('button', { name: /^All / })).toBeNull();
  });

  it('shows five and All N entries over six; the sheet lists every one, a card per collection', async () => {
    renderApp({ source: await surveySite(5), route: 'question/age' });
    const region = await usedBy(7);
    expect(inlineLinks(region)).toHaveLength(5);
    const all = within(region).getByRole('button', { name: 'All 7 entries' });
    expect(all.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(all);
    const modal = await sheet('Used by');
    expect(modal.getByText('How old are you? · 7 entries')).toBeDefined();
    // Seven is not over ten: no search.
    expect(modal.queryByRole('searchbox')).toBeNull();
    expect(modal.getAllByRole('link')).toHaveLength(7);
    // Two collections: one card each, under its label.
    expect(modal.getByRole('region', { name: 'Option' }).querySelectorAll('a')).toHaveLength(6);
    expect(modal.getByRole('region', { name: 'Section' }).querySelectorAll('a')).toHaveLength(1);
  });

  it('searches over ten by title and by ref', async () => {
    renderApp({ source: await surveySite(9), route: 'question/age' });
    fireEvent.click(within(await usedBy(11)).getByRole('button', { name: 'All 11 entries' }));
    const modal = await sheet('Used by');
    const search = modal.getByRole('searchbox', { name: 'Search entries' });
    fireEvent.change(search, { target: { value: 'extra 0' } });
    expect(modal.getAllByRole('link')).toHaveLength(9);
    fireEvent.change(search, { target: { value: 'SECTION/about' } });
    expect(modal.getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringMatching(/^About you/)]);
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(modal.getByText('No entries match')).toBeDefined();
  });

  it('opens a row and closes; Escape returns the focus to the row', async () => {
    renderApp({ source: await surveySite(5), route: 'question/age' });
    const all = within(await usedBy(7)).getByRole('button', { name: 'All 7 entries' });
    // A real press focuses the row first (jsdom's click does not).
    all.focus();
    fireEvent.click(all);
    await sheet('Used by');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Used by' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(all));

    fireEvent.click(all);
    const modal = await sheet('Used by');
    fireEvent.click(modal.getByRole('link', { name: /^Extra 03 / }));
    await waitFor(() => expect(route()).toBe('option/extra-03'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Used by' })).toBeNull());
  });

  it('keeps the sheet open when the guard refuses the navigation', async () => {
    renderApp({ source: await surveySite(5), route: 'question/age' });
    const region = await usedBy(7);
    await setField('Prompt', 'How old?');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(region).getByRole('button', { name: 'All 7 entries' }));
    const modal = await sheet('Used by');
    fireEvent.click(modal.getByRole('link', { name: /^Extra 01 / }));
    expect(confirm).toHaveBeenCalled();
    expect(route()).toBe('question/age');
    expect(screen.getByRole('dialog', { name: 'Used by' })).toBeDefined();
  });

  it('caps the delete confirm at five and still updates all of them', async () => {
    renderApp({ source: await surveySite(5), route: 'question/age' });
    await usedBy(7);
    await moreAction('Delete…');
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getAllByRole('link')).toHaveLength(5);
    expect(dialog.getByText('and 2 more')).toBeDefined();
    expect(dialog.getByText('Also remove the references from 7 entries')).toBeDefined();
    fireEvent.click(dialog.getByRole('checkbox'));
    expect(dialog.getByRole('button', { name: 'Delete and update 7' })).toBeDefined();
  });
});
