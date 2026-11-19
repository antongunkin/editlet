import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalSource } from './source/local';
import {
  doneField,
  fieldRow,
  findCta,
  moreAction,
  openField,
  renderApp,
  rowText,
  saveReview,
  setField,
  sheet,
} from './test/render';

import { createDevHandler } from '../../node/devHandler';

const survey = join(import.meta.dirname, '../../__fixtures__/survey');

// Each case is a long flow over the real dev handler and disk: allow for a slow machine.
configure({ asyncUtilTimeout: 10_000 });
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The admin against the real dev handler on a temp copy of the survey fixture (no network, real disk). */
async function surveySite(edit?: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'editlet-refs-'));
  temps.push(root);
  await cp(survey, root, { recursive: true });
  await edit?.(root);
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  return { root, source: createLocalSource({ fetch }) };
}

const main = () => screen.getByRole('main');
const route = () => new URLSearchParams(window.location.search).get('editlet');

/** A reference to many (`label`): opens its modal, then *Add*, searches `query`, ticks `option`, adds it, Done. */
async function pickMany(label: string, query: string, option: string) {
  const modal = await openField(label);
  fireEvent.click(modal.getByRole('button', { name: `Add ${label.toLowerCase()}` }));
  const add = await sheet(`Add ${label.toLowerCase()}`);
  fireEvent.change(add.getByRole('searchbox'), { target: { value: query } });
  fireEvent.click(await add.findByRole('checkbox', { name: new RegExp(`^${option}`) }));
  fireEvent.click(add.getByRole('button', { name: 'Add 1 entry' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: `Add ${label.toLowerCase()}` })).toBeNull());
  return modal;
}

/** A reference to one (`label`): opens its modal, searches `query` and taps `option`, which closes it. */
async function pickOne(label: string, query: string, option: string) {
  const modal = await openField(label);
  fireEvent.change(modal.getByRole('searchbox'), { target: { value: query } });
  fireEvent.click(await modal.findByRole('radio', { name: new RegExp(`^${option}`) }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: label })).toBeNull());
}

/** Closes a modal that has no Done (a single choice) with Escape. */
async function doneOrClose(name: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());
}

async function save() {
  fireEvent.click(await findCta(/^Save/));
  await saveReview();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('references in the admin, end to end', { timeout: 60_000 }, () => {
  it('picks a related entry, saves, opens it, edits it and saves again', async () => {
    const { root, source } = await surveySite();
    renderApp({ source, route: 'survey/pulse' });

    // The rows are the saved references, titled and openable.
    await screen.findByRole('button', { name: /^Sections/ });
    const sections = await openField('Sections');
    const chips = sections.getByRole('list', { name: 'Sections selected' });
    await within(chips).findByRole('link', { name: 'Feedback' });
    await doneField();

    // Add "About you" from a search for "about" and save: the file on disk gets the reference.
    const modal = await pickMany('Sections', 'about', 'About you');
    await within(modal.getByRole('list', { name: 'Sections selected' })).findByRole('link', { name: 'About you' });
    await doneField();
    await save();
    const pulse = join(root, 'cms/content/survey/pulse.md');
    await waitFor(async () =>
      expect(await readFile(pulse, 'utf8')).toContain('sections:\n  - section/feedback\n  - section/about-you\n'),
    );

    // Open the related entry from its row in the modal (the form remounted on the saved file).
    await waitFor(() => {
      const open = screen.queryByRole('dialog', { name: 'Sections' });
      if (!open) {
        fireEvent.click(fieldRow('Sections'));
        throw new Error('Opening Sections');
      }
      fireEvent.click(within(open).getByRole('link', { name: 'About you' }));
      expect(route()).toBe('section/about-you');
    });
    await waitFor(() => expect(rowText('Title')).toContain('About you'));

    // Its "Used by" lists both surveys now, each a link back.
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 2 entries' });
    expect(within(usedBy).getByRole('link', { name: /^Monthly pulse / })).toBeDefined();
    expect(within(usedBy).getByText('survey/onboarding · via Sections')).toBeDefined();

    // Edit the related entry and save it: the reference in the survey is untouched.
    await setField('Title', 'About you and your team');
    await save();
    await waitFor(async () =>
      expect(await readFile(join(root, 'cms/content/section/about-you.md'), 'utf8')).toContain(
        'title: About you and your team',
      ),
    );
    expect(await readFile(pulse, 'utf8')).toContain('  - section/about-you\n');

    // Back in the survey, the chip shows the new title.
    await waitFor(() => {
      const list = within(main()).getByRole('region', { name: 'Used by 2 entries' });
      fireEvent.click(within(list).getByRole('link', { name: /^Monthly pulse / }));
      expect(route()).toBe('survey/pulse');
    });
    await waitFor(() => expect(rowText('Sections')).toContain('About you and your team'));
    const again = await openField('Sections');
    await within(again.getByRole('list', { name: 'Sections selected' })).findByRole('link', {
      name: 'About you and your team',
    });
  });

  it('opens the entry of a single reference down the tree: question → next question', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'question/role' });
    await screen.findByRole('button', { name: /^Next question/ });
    const next = await openField('Next question');
    fireEvent.click(await next.findByRole('link', { name: 'Open How likely are you to recommend us?' }));
    await waitFor(() => expect(route()).toBe('question/rating'));
    await screen.findByRole('button', { name: /^Options/ });
    const options = within((await openField('Options')).getByRole('list', { name: 'Options selected' }));
    expect(await options.findByRole('link', { name: 'Very likely' })).toBeDefined();
    fireEvent.click(options.getByRole('link', { name: 'Very likely' }));
    await waitFor(() => expect(route()).toBe('option/rating-high'));
    // The cycle back up the tree is just another link.
    await screen.findByRole('button', { name: /^Follow-up question/ });
    await (await openField('Follow-up question')).findByRole('link', { name: 'Open What is your role?' });
  });

  it('marks a broken reference in the field before Save', async () => {
    const { source } = await surveySite(async (root) => {
      const file = join(root, 'cms/content/question/role.md');
      await writeFile(file, (await readFile(file, 'utf8')).replace('question/rating', 'question/gone'));
    });
    renderApp({ source, route: 'question/role' });
    await screen.findByRole('button', { name: /^Next question/ });
    await waitFor(() => expect(rowText('Next question')).toContain('Not found: question/gone'));
    const modal = await openField('Next question');
    expect(modal.getByText('Not found: question/gone')).toBeDefined();
    expect(modal.queryByRole('link', { name: /^Open / })).toBeNull();
    await doneOrClose('Next question');
    // Save keeps the issue, marks the row and opens no review; picking an existing entry fixes it.
    await setField('Prompt', 'Your role?');
    fireEvent.click(await findCta('Save 1 change'));
    await findCta('Fix 1 field');
    expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull();
    expect(rowText('Next question')).toContain('Check this');
    await pickOne('Next question', 'old', 'How old are you?');
    await waitFor(() => expect(rowText('Next question')).toContain('How old are you?'));
    await save();
  });

  it('does not offer Delete while other entries reference the entry', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'section/feedback' });
    await within(main()).findByRole('region', { name: 'Used by 2 entries' });
    await moreAction('Delete…');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Other entries reference this one/)).toBeDefined();
    expect(within(dialog).getByRole('link', { name: /^Onboarding survey / })).toBeDefined();
    expect((within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('deletes an entry nothing references', async () => {
    const { root, source } = await surveySite();
    renderApp({ source, route: 'survey/pulse' });
    await screen.findByRole('button', { name: /^Sections/ });
    await moreAction('Delete…');
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(route()).toBe('survey'));
    await expect(readFile(join(root, 'cms/content/survey/pulse.md'))).rejects.toThrow();
  });
  it('picks a single reference from a search, saves it, clears it and saves again', async () => {
    const { root, source } = await surveySite();
    const file = join(root, 'cms/content/question/age.md');
    renderApp({ source, route: 'question/age' });
    await screen.findByRole('button', { name: /^Next question/ });
    // The search narrows the list to one entry.
    const modal = await openField('Next question');
    fireEvent.change(modal.getByRole('searchbox'), { target: { value: 'role' } });
    await waitFor(() =>
      expect(modal.getAllByRole('radio').map((r) => r.textContent)).toEqual(['What is your role?question/role']),
    );
    fireEvent.click(modal.getByRole('radio'));
    await waitFor(() => expect(rowText('Next question')).toContain('What is your role?'));
    const row = fieldRow('Next question');
    await save();
    await waitFor(async () => expect(await readFile(file, 'utf8')).toContain('next: question/role\n'));

    // Clear it in the form that the saved file remounted.
    await waitFor(() => expect(row.isConnected).toBe(false));
    const again = await openField('Next question');
    fireEvent.click(await again.findByRole('button', { name: 'Clear Next question' }));
    await save();
    await waitFor(async () => expect(await readFile(file, 'utf8')).not.toContain('next:'));
  });

  it('removes a chip from a list and saves the shorter list', async () => {
    const { root, source } = await surveySite();
    const file = join(root, 'cms/content/question/age.md');
    renderApp({ source, route: 'question/age' });
    await screen.findByRole('button', { name: /^Options/ });
    const chips = within((await openField('Options')).getByRole('list', { name: 'Options selected' }));
    // A draft target is a normal choice in the admin.
    await chips.findByRole('link', { name: 'Prefer not to say' });
    fireEvent.click(chips.getByRole('button', { name: 'Remove Prefer not to say' }));
    await doneField();
    await save();
    await waitFor(async () =>
      expect(await readFile(file, 'utf8')).toContain('options:\n  - option/age-young\n  - option/age-adult\n---'),
    );
  });

  it('offers only entries not in the list yet, searched by collection/slug too', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'survey/onboarding' });
    await screen.findByRole('button', { name: /^Sections/ });
    const sections = await openField('Sections');
    fireEvent.click(sections.getByRole('button', { name: 'Add sections' }));
    // Both sections are chosen already.
    const add = await sheet('Add sections');
    await waitFor(() => expect(add.getByText('No entries to add')).toBeDefined());
    expect(add.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add sections' })).toBeNull());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sections' })).toBeNull());
    await waitFor(() => expect(rowText('Brand')).toContain('Acme Research'));
    const brand = await openField('Brand');
    fireEvent.change(brand.getByRole('searchbox'), { target: { value: 'brand/index' } });
    await waitFor(() =>
      expect(brand.getAllByRole('radio').map((o) => o.textContent)).toEqual(['Acme Researchbrand/index']),
    );
  });

  it('opens a singleton target, which lists its referrer', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'survey/onboarding' });
    await screen.findByRole('button', { name: /^Brand/ });
    fireEvent.click(await (await openField('Brand')).findByRole('link', { name: 'Open Acme Research' }));
    await waitFor(() => expect(route()).toBe('brand/index'));
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 1 entry' });
    expect(within(usedBy).getByText('survey/onboarding · via Brand')).toBeDefined();
  });

  it('shows a cycle as ordinary links both ways', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'question/age' });
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 2 entries' });
    expect(within(usedBy).getByText('option/age-adult · via Follow-up question')).toBeDefined();
    fireEvent.click(within(usedBy).getByRole('link', { name: /^18 or older / }));
    await waitFor(() => expect(route()).toBe('option/age-adult'));
    await screen.findByRole('button', { name: /^Follow-up question/ });
    fireEvent.click(
      await (await openField('Follow-up question')).findByRole('link', { name: 'Open How old are you?' }),
    );
    await waitFor(() => expect(route()).toBe('question/age'));
  });
});
