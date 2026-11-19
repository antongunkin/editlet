import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';

import { fixtureFiles } from './fixture';

import { createMemorySource, type ContentSource } from '../../../core/source';
import { withEditletRoute } from '../../../loader/protocol';
import { App } from '../App';

export { fixtureFiles };

/** Home's *All content* row once the files are listed (`23 entries · media · model`): Home has loaded. */
export const HOME_LOADED = /^All content\s*\d+ entr/;

/** From Home: open *All content*, then the collection with this label. */
export async function openCollection(scope: ReturnType<typeof within>, label: string) {
  fireEvent.click(await scope.findByRole('link', { name: HOME_LOADED }));
  fireEvent.click(
    await scope.findByRole('link', { name: new RegExp(`^${escape(label)}s?\\s*(\\d+ entr|Single page)`) }),
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The open entry's screen (`data-editlet="screen"` inside `main`). */
export function entryScreen(): HTMLElement {
  const el = screen.getByRole('main').querySelector<HTMLElement>('[data-editlet="screen"]');
  if (!el) throw new Error('No entry screen');
  return el;
}

/** The card of the entry's field rows (a `fieldset` named `<collection>/<slug> fields`). */
export function fieldRows() {
  return within(screen.getByRole('group', { name: / fields$/ }));
}

/** A field's row: the button whose name starts with the field's label (or, for a boolean, its row element). */
export function fieldRow(label: string, scope: ReturnType<typeof within> = fieldRows()): HTMLElement {
  return scope.getByRole('button', { name: new RegExp(`^${escape(label)}`) });
}

/** The topmost open sheet named `name` (a field's modal, the Details sheet). */
export async function sheet(name: string | RegExp) {
  const all = await screen.findAllByRole('dialog', { name });
  return within(all.at(-1)!);
}

/**
 * Opens a field's modal from its row (one field per modal) and returns queries inside it. `scope` is where the row is:
 * the entry's card by default, or an open sheet (an object's fields, a block's fields).
 */
export async function openField(label: string, scope?: ReturnType<typeof within>) {
  fireEvent.click(fieldRow(label, scope));
  return sheet(label);
}

/** Closes the topmost open sheet with its Done button and waits until it is gone. */
export async function doneField() {
  const dialogs = screen.getAllByRole('dialog');
  const top = dialogs.at(-1)!;
  fireEvent.click(within(top).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(top.isConnected && top.hasAttribute('data-open')).toBe(false));
}

/** The open modal sheets, bottom first (a toast is a non-modal dialog: not one of them). */
const openSheets = () => screen.queryAllByRole('dialog').filter((d) => d.getAttribute('aria-modal') !== 'false');

/** Closes the topmost open sheet with its × (Close) and waits until it is gone; the one under it stays open. */
export async function closeSheet() {
  const top = openSheets().at(-1);
  if (!top) throw new Error('No open sheet');
  fireEvent.click(within(top).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(top.isConnected).toBe(false));
}

/** Closes every open sheet, top first, with its × (Close). Only the top one is exposed; the others are inert under it. */
export async function closeSheets() {
  while (openSheets().length > 0) await closeSheet();
}

/** Opens the Title field's modal (once its row is there) and returns its input. */
export async function openTitle(): Promise<HTMLInputElement> {
  await screen.findByRole('button', { name: /^Title/ });
  const modal = await openField('Title');
  return modal.getByLabelText(/^Title/) as HTMLInputElement;
}

/** Types `value` into a text field's modal (opened from its row) and closes it with Done. */
export async function setField(label: string, value: string, scope?: ReturnType<typeof within>) {
  const modal = await openField(label, scope);
  fireEvent.change(modal.getByLabelText(new RegExp(`^${escape(label)}`)), { target: { value } });
  await doneField();
}

/** What a field's row shows: its label line and its value (`Title *Hello world`). */
export function rowText(label: string, scope?: ReturnType<typeof within>): string {
  return fieldRow(label, scope).textContent ?? '';
}

/** Opens the entry's ⋯ (More actions) and clicks the action named `name` (`Delete…`, `Rename…`, `Discard changes`). */
export async function moreAction(name: string | RegExp) {
  fireEvent.click(within(entryScreen()).getByRole('button', { name: 'More actions' }));
  const action = await screen.findByRole('button', { name });
  fireEvent.click(action);
  return action;
}

/** Opens the entry's ⋯ action sheet and returns queries inside it (to check an action is disabled or absent). */
export async function moreActions() {
  fireEvent.click(within(entryScreen()).getByRole('button', { name: 'More actions' }));
  const popup = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-slot="action-sheet"]');
    if (!el) throw new Error('No action sheet');
    return el;
  });
  return within(popup);
}

/** The entry screen's bottom bar (status line and CTA), not a sheet's. */
export function entryBar() {
  const bar = entryScreen().querySelector<HTMLElement>(':scope > [data-slot="bottom-bar"]');
  if (!bar) throw new Error('No bottom bar');
  return within(bar);
}

/**
 * The entry's one CTA in its bottom bar (`Save`, `Save 1 change`, `Fix 1 field`, `Saving…`), or `null` when there is
 * none (a clean entry).
 */
export function cta(): HTMLButtonElement | null {
  const bar = entryScreen().querySelector<HTMLElement>(':scope > [data-slot="bottom-bar"]');
  return bar?.querySelector<HTMLButtonElement>(':scope > div:not([data-slot]) > :is(button, a)') ?? null;
}

/** Waits for the CTA and returns it. */
export async function findCta(name?: string | RegExp): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const button = cta();
    if (!button) throw new Error('No CTA');
    if (
      name !== undefined &&
      !(typeof name === 'string' ? button.textContent === name : name.test(button.textContent ?? ''))
    )
      throw new Error(`CTA is "${button.textContent}"`);
    return button;
  });
}

/** The one CTA in an open sheet's bottom bar (*Save 1 change*, *Save to new branch*, *Create branch*). */
export function sheetCta(dialog: HTMLElement): HTMLButtonElement {
  const button = dialog.querySelector<HTMLButtonElement>('[data-slot="bottom-bar"] :is(button, a)');
  if (!button) throw new Error('No CTA in the sheet');
  return button;
}

/** The topmost open sheet named `name`, as its element (for `sheetCta` or a `within`). */
export async function sheetElement(name: string | RegExp): Promise<HTMLElement> {
  const all = await screen.findAllByRole('dialog', { name });
  return all.at(-1)!;
}

/** The save review (*Your changes*), once it is open. */
export function reviewSheet() {
  return sheet('Your changes');
}

/** The save review's CTA (*Save 1 change*, *Save* for a new entry). */
export async function reviewCta(): Promise<HTMLButtonElement> {
  return sheetCta(await sheetElement('Your changes'));
}

/** Opens an entry's diff from its row in the save review and returns the nested sheet (named by the entry's title). */
export async function openEntryDiff(title: string) {
  const review = await reviewSheet();
  fireEvent.click(review.getByRole('button', { name: new RegExp(`^${escape(title)}`) }));
  return sheet(title);
}

/** On the base branch: the review's CTA opens *Save to* (the new-branch field); returns queries inside it. */
export async function openSaveTo() {
  fireEvent.click(await reviewCta());
  return sheet('Save to');
}

/**
 * Saves from the open review: its CTA saves, or, on the base branch in GitHub mode (the review has a *Save to* row that
 * opens), it opens *Save to*, where `branch` (the name after the prefix; the suggested one by default) is typed and
 * *Save to new branch* saves.
 */
export async function saveReview({ branch }: { branch?: string } = {}) {
  const review = await reviewSheet();
  if (!review.queryByRole('button', { name: /^Save to/ })) {
    await act(async () => fireEvent.click(await reviewCta()));
    return;
  }
  const saveTo = await openSaveTo();
  if (branch !== undefined) fireEvent.change(saveTo.getByLabelText(/^New branch/), { target: { value: branch } });
  await act(async () => fireEvent.click(saveTo.getByRole('button', { name: 'Save to new branch' })));
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
}

export type RenderAppOptions = {
  files?: Record<string, string | Uint8Array>;
  /** `?editlet` route to start on (default home). */
  route?: string;
  source?: ContentSource;
  queryClient?: QueryClient;
  /** Window for the bridge (e.g. `createFakeWindow().win` for an embedded admin); its own `location` is used. */
  win?: Window;
};

/**
 * Renders the standalone `<App>` (jsdom: `window.parent === window`) at `/editlet/?editlet=<route>` over a memory source
 * (built from `files`, default the fixture site) and a QueryClient without retries.
 */
export function renderApp({ files, route = '', source, queryClient, win }: RenderAppOptions = {}) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', route));
  if (win) win.history.replaceState(null, '', withEditletRoute(win.location.href, route));
  const src = source ?? createMemorySource(files ?? fixtureFiles());
  const client = queryClient ?? createTestQueryClient();
  const result = render(<App source={src} queryClient={client} win={win} />);
  return { source: src, queryClient: client, ...result };
}
