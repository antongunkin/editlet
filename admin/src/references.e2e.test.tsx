import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalSource } from './source/local';
import { entryActions, renderApp } from './test/render';

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

/** Focuses the combobox of `label`, types `query` and picks the option named `option` by click. */
async function pick(label: RegExp, query: string, option: string) {
  const input = await within(main()).findByRole('combobox', { name: label });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  const list = screen.getByRole('listbox', { hidden: false });
  fireEvent.click(await within(list).findByRole('option', { name: new RegExp(`^${option}`) }));
}

async function save() {
  const button = entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('references in the admin, end to end', { timeout: 60_000 }, () => {
  it('picks a related entry, saves, opens it, edits it and saves again', async () => {
    const { root, source } = await surveySite();
    renderApp({ source, route: 'survey/pulse' });

    // The chips are the saved references, titled and openable.
    const chips = await within(main()).findByRole('list', { name: 'Sections selected' });
    await within(chips).findByRole('link', { name: 'Feedback' });

    // Search "about" in the Sections combobox, pick "About you" and save: the file on disk gets the reference.
    await pick(/^Sections/, 'about', 'About you');
    await within(chips).findByRole('link', { name: 'About you' });
    await save();
    const pulse = join(root, 'cms/content/survey/pulse.md');
    await waitFor(async () =>
      expect(await readFile(pulse, 'utf8')).toContain('sections:\n  - section/feedback\n  - section/about-you\n'),
    );

    // Open the related entry from its chip. The form remounts once the saved file loads, so look the link up again.
    await waitFor(() => {
      const saved = within(main()).getByRole('list', { name: 'Sections selected' });
      fireEvent.click(within(saved).getByRole('link', { name: 'About you' }));
      expect(route()).toBe('section/about-you');
    });
    const title = (await within(main()).findByLabelText(/^Title/)) as HTMLInputElement;
    expect(title.value).toBe('About you');

    // Its "Used by" lists both surveys now, each a link back.
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 2 entries' });
    expect(within(usedBy).getByRole('link', { name: 'Monthly pulse' })).toBeDefined();
    expect(within(usedBy).getByText('survey/onboarding · via Sections')).toBeDefined();

    // Edit the related entry and save it: the reference in the survey is untouched.
    fireEvent.change(title, { target: { value: 'About you and your team' } });
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
      fireEvent.click(within(list).getByRole('link', { name: 'Monthly pulse' }));
      expect(route()).toBe('survey/pulse');
    });
    const again = await within(main()).findByRole('list', { name: 'Sections selected' });
    await within(again).findByRole('link', { name: 'About you and your team' });
  });

  it('opens the entry of a single reference down the tree: question → next question', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'question/role' });
    const open = await within(main()).findByRole('link', { name: 'Open How likely are you to recommend us?' });
    fireEvent.click(open);
    await waitFor(() => expect(route()).toBe('question/rating'));
    const options = await within(main()).findByRole('list', { name: 'Options selected' });
    expect(within(options).getByRole('link', { name: 'Very likely' })).toBeDefined();
    fireEvent.click(within(options).getByRole('link', { name: 'Very likely' }));
    await waitFor(() => expect(route()).toBe('option/rating-high'));
    // The cycle back up the tree is just another link.
    await within(main()).findByRole('link', { name: 'Open What is your role?' });
  });

  it('marks a broken reference in the field before Save', async () => {
    const { source } = await surveySite(async (root) => {
      const file = join(root, 'cms/content/question/role.md');
      await writeFile(file, (await readFile(file, 'utf8')).replace('question/rating', 'question/gone'));
    });
    renderApp({ source, route: 'question/role' });
    const input = (await within(main()).findByRole('combobox', { name: /^Next question/ })) as HTMLInputElement;
    await waitFor(() => expect(within(main()).getByText('Referenced entry not found: question/gone')).toBeDefined());
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.value).toBe('Not found: question/gone');
    expect(within(main()).queryByRole('link', { name: /^Open / })).toBeNull();
    // Save keeps the issue and opens no review; picking an existing entry fixes it.
    fireEvent.change(within(main()).getByLabelText(/^Prompt/), { target: { value: 'Your role?' } });
    const button = entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    await pick(/^Next question/, 'old', 'How old are you?');
    await waitFor(() => expect(within(main()).queryByText('Referenced entry not found: question/gone')).toBeNull());
    await save();
  });

  it('does not offer Delete while other entries reference the entry', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'section/feedback' });
    await within(main()).findByRole('region', { name: 'Used by 2 entries' });
    fireEvent.click(entryActions().getByRole('button', { name: 'Delete', hidden: true }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Other entries reference this one/)).toBeDefined();
    expect(within(dialog).getByRole('link', { name: 'Onboarding survey' })).toBeDefined();
    expect((within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('deletes an entry nothing references', async () => {
    const { root, source } = await surveySite();
    renderApp({ source, route: 'survey/pulse' });
    await within(main()).findByRole('list', { name: 'Sections selected' });
    fireEvent.click(entryActions().getByRole('button', { name: 'Delete', hidden: true }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(route()).toBe('survey'));
    await expect(readFile(join(root, 'cms/content/survey/pulse.md'))).rejects.toThrow();
  });
  it('picks a single reference with the keyboard, saves it, clears it and saves again', async () => {
    const { root, source } = await surveySite();
    const file = join(root, 'cms/content/question/age.md');
    renderApp({ source, route: 'question/age' });
    const input = await within(main()).findByRole('combobox', { name: /^Next question/ });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'role' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await within(main()).findByRole('link', { name: 'Open What is your role?' });
    await save();
    await waitFor(async () => expect(await readFile(file, 'utf8')).toContain('next: question/role\n'));

    // The form remounts on the saved file; clear the field of the new form.
    await waitFor(() => expect(input.isConnected).toBe(false));
    fireEvent.click(await within(main()).findByRole('button', { name: 'Clear Next question' }));
    await save();
    await waitFor(async () => expect(await readFile(file, 'utf8')).not.toContain('next:'));
  });

  it('removes a chip from a list and saves the shorter list', async () => {
    const { root, source } = await surveySite();
    const file = join(root, 'cms/content/question/age.md');
    renderApp({ source, route: 'question/age' });
    const chips = await within(main()).findByRole('list', { name: 'Options selected' });
    // A draft target is a normal choice in the admin.
    await within(chips).findByRole('link', { name: 'Prefer not to say' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove Prefer not to say' }));
    await save();
    await waitFor(async () =>
      expect(await readFile(file, 'utf8')).toContain('options:\n  - option/age-young\n  - option/age-adult\n---'),
    );
  });

  it('offers only entries not in the list yet, searched by collection/slug too', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'survey/onboarding' });
    const input = await within(main()).findByRole('combobox', { name: /^Sections/ });
    fireEvent.focus(input);
    // Both sections are chosen already.
    expect(within(screen.getByRole('listbox')).getByText('No matching entries')).toBeDefined();
    fireEvent.keyDown(input, { key: 'Escape' });
    const brand = await within(main()).findByRole('combobox', { name: /^Brand/ });
    await waitFor(() => expect((brand as HTMLInputElement).value).toBe('Acme Research'));
    fireEvent.focus(brand);
    fireEvent.change(brand, { target: { value: 'brand/index' } });
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Acme Researchbrand/index']);
  });

  it('opens a singleton target, which lists its referrer', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'survey/onboarding' });
    fireEvent.click(await within(main()).findByRole('link', { name: 'Open Acme Research' }));
    await waitFor(() => expect(route()).toBe('brand/index'));
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 1 entry' });
    expect(within(usedBy).getByText('survey/onboarding · via Brand')).toBeDefined();
  });

  it('shows a cycle as ordinary links both ways', async () => {
    const { source } = await surveySite();
    renderApp({ source, route: 'question/age' });
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 2 entries' });
    expect(within(usedBy).getByText('option/age-adult · via Follow-up question')).toBeDefined();
    fireEvent.click(within(usedBy).getByRole('link', { name: '18 or older' }));
    await waitFor(() => expect(route()).toBe('option/age-adult'));
    fireEvent.click(await within(main()).findByRole('link', { name: 'Open How old are you?' }));
    await waitFor(() => expect(route()).toBe('question/age'));
  });
});
