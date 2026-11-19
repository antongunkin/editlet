// A referenced entry edited on top of the reference picker (modals-2 M.5 + M.6): its edits go to the changes buffer.
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createDevHandler } from '../../../node/devHandler';
import { createLocalSource } from '../source/local';
import { doneField, openField, renderApp, saveReview, sheet } from '../test/render';

const survey = join(import.meta.dirname, '../../../__fixtures__/survey');
configure({ asyncUtilTimeout: 10_000 });
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function surveySite() {
  const root = await mkdtemp(join(tmpdir(), 'editlet-top-'));
  temps.push(root);
  await cp(survey, root, { recursive: true });
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  return { root, source: createLocalSource({ fetch }) };
}

const RATING = 'How likely are you to recommend us?';
const route = () => new URLSearchParams(window.location.search).get('editlet');

/** question/role → its Next question picker, with the rating question on top. */
async function openOnTop() {
  const site = await surveySite();
  renderApp({ source: site.source, route: 'question/role' });
  await screen.findByRole('button', { name: /^Next question/ });
  const picker = await openField('Next question');
  const edit = await picker.findByRole('button', { name: `Edit ${RATING}` });
  // A real press focuses the button first (jsdom's click does not): the focus returns to it.
  edit.focus();
  fireEvent.click(edit);
  const top = await sheet(RATING);
  return { ...site, picker, top };
}

describe('Edit on top of a reference', () => {
  it('opens the chosen entry with its rows; Edit is not offered for another picker inside it', async () => {
    const { top } = await openOnTop();
    expect(top.getByText('Question')).toBeDefined();
    expect(top.getByRole('button', { name: /^Prompt/ })).toBeDefined();
    expect(top.getByRole('link', { name: `Go to ${RATING}` })).toBeDefined();
    // One entry on top: the Options list inside it shows plain links, no Edit.
    fireEvent.click(top.getByRole('button', { name: /^Options/ }));
    const options = await sheet('Options');
    expect(await options.findByRole('link', { name: 'Very likely' })).toBeDefined();
    expect(options.queryByRole('button', { name: /^Edit / })).toBeNull();
  });

  it('keeps the edit in the buffer: the outer form is unchanged, both entries count, Done and reopening keep it', async () => {
    const { picker, top } = await openOnTop();
    // The sheet's own field rows have their own ids: no duplicate with the outer form.
    fireEvent.click(top.getByRole('button', { name: /^Prompt/ }));
    const prompt = await sheet('Prompt');
    fireEvent.change(prompt.getByLabelText(/^Prompt/), { target: { value: 'Would you recommend us?' } });
    await doneField();
    expect((await sheet('Would you recommend us?')).getByText('Question · Unsaved')).toBeDefined();
    // Done closes the sheet only; the picker is still open.
    fireEvent.click((await sheet('Would you recommend us?')).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Would you recommend us?' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Next question' })).toBeDefined();
    // The screen's status line counts the entry on top (the picker still names it by its saved title).
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Unsaved changes (1)', hidden: true }).length).toBeGreaterThan(0),
    );
    // Reopening reads the buffered row back.
    fireEvent.click(picker.getByRole('button', { name: `Edit ${RATING}` }));
    expect(
      (await sheet('Would you recommend us?')).getByRole('button', { name: /^Prompt.*Would you recommend us\?/ }),
    ).toBeDefined();
  });

  it('one Save from the entry under it saves both files; Go to leaves for the entry', async () => {
    const { root, top } = await openOnTop();
    fireEvent.click(top.getByRole('button', { name: /^Prompt/ }));
    fireEvent.change((await sheet('Prompt')).getByLabelText(/^Prompt/), {
      target: { value: 'Would you recommend us?' },
    });
    await doneField();
    fireEvent.click((await sheet('Would you recommend us?')).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Would you recommend us?' })).toBeNull());
    // Close the picker, then change the entry under it too, and save.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Next question' })).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: /^Prompt/ }));
    fireEvent.change((await sheet('Prompt')).getByLabelText(/^Prompt/), { target: { value: 'Your role?' } });
    await doneField();
    fireEvent.click(await screen.findByRole('button', { name: 'Save 2 changes' }));
    await saveReview();
    await waitFor(async () =>
      expect(await readFile(join(root, 'cms/content/question/rating.md'), 'utf8')).toContain(
        'prompt: Would you recommend us?',
      ),
    );
    expect(await readFile(join(root, 'cms/content/question/role.md'), 'utf8')).toContain('prompt: Your role?');
  });

  it('Go to navigates to the entry', async () => {
    const { top } = await openOnTop();
    fireEvent.click(top.getByRole('link', { name: `Go to ${RATING}` }));
    await waitFor(() => expect(route()).toBe('question/rating'));
  });

  it('Escape closes one level at a time and the focus returns to Edit', async () => {
    const { picker } = await openOnTop();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: RATING })).toBeNull());
    const edit = picker.getByRole('button', { name: `Edit ${RATING}` });
    await waitFor(() => expect(document.activeElement).toBe(edit));
    expect(screen.getByRole('dialog', { name: 'Next question' })).toBeDefined();
  });
});
