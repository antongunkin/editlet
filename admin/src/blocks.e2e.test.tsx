import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalSource } from './source/local';
import { entryActions, renderApp } from './test/render';

import { createDevHandler } from '../../node/devHandler';

const survey = join(import.meta.dirname, '../../__fixtures__/survey');
const temps: string[] = [];

// Each case is a long flow over the real dev handler and disk: allow for a slow machine.
configure({ asyncUtilTimeout: 10_000 });

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The admin against the real dev handler on a temp copy of the survey fixture (no network, real disk). */
async function site() {
  const root = await mkdtemp(join(tmpdir(), 'editlet-blocks-'));
  temps.push(root);
  await cp(survey, root, { recursive: true });
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  const file = (name: string) => join(root, 'cms/content', name);
  return { root, file, read: (name: string) => readFile(file(name), 'utf8'), source: createLocalSource({ fetch }) };
}

const main = () => screen.getByRole('main');
const route = () => new URLSearchParams(window.location.search).get('editlet');
const blocks = () => within(main()).getByRole('list', { name: 'Content items' });
const block = (n: number) =>
  within(blocks())
    .getAllByRole('listitem')
    .filter((li) => li.parentElement === blocks())[n - 1]!;

async function save() {
  const button = entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /^Save/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** Opens `page/landing` and waits for its blocks. */
async function openLanding() {
  const s = await site();
  renderApp({ source: s.source, route: 'page/landing' });
  await within(main()).findByRole('list', { name: 'Content items' });
  return s;
}

describe('object and blocks in the admin, end to end', () => {
  it('shows every block as a titled card with its fields', async () => {
    await openLanding();
    const items = within(blocks())
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === blocks());
    expect(items.map((li) => li.getAttribute('aria-label'))).toEqual([
      '1. Hero · Your opinion, five minutes a month',
      '2. Features',
      '3. Text',
      '4. Survey · Takes five minutes.',
      '5. Quote · Quick and painless.',
    ]);
    // Fields of a block, and of an object inside it.
    expect((within(block(1)).getByLabelText(/^Title/) as HTMLInputElement).value).toBe(
      'Your opinion, five minutes a month',
    );
    const button = within(block(1)).getByRole('group', { name: /^Button/ });
    expect((within(button).getByLabelText(/^URL/) as HTMLInputElement).value).toBe('/survey/onboarding');
    // A list of objects inside a block.
    const features = within(block(2)).getByRole('list', { name: 'Items items' });
    expect(
      within(features)
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['1. Item · Fast', '2. Item · Private']);
  });

  it('edits a field inside a block and inside a nested object, and saves only those lines', async () => {
    const { read } = await openLanding();
    const before = await read('page/landing.md');
    fireEvent.change(within(block(1)).getByLabelText(/^Title/), { target: { value: 'Five minutes a month' } });
    const by = within(block(5)).getByRole('group', { name: /^By/ });
    fireEvent.change(within(by).getByLabelText(/^Name/), { target: { value: 'Jane Doe' } });
    await save();
    await waitFor(async () =>
      expect(await read('page/landing.md')).toBe(
        before
          .replace('title: Your opinion, five minutes a month', 'title: Five minutes a month')
          .replace('name: Jane', 'name: Jane Doe'),
      ),
    );
  });

  it('adds a block of a chosen kind at the end and saves it', async () => {
    const { read } = await openLanding();
    fireEvent.click(within(main()).getByRole('button', { name: 'Add block' }));
    const kinds = within(main()).getByRole('group', { name: 'Content: block kinds' });
    fireEvent.click(within(kinds).getByRole('button', { name: 'Quote' }));
    expect(within(main()).queryByRole('group', { name: 'Content: block kinds' })).toBeNull();
    fireEvent.change(within(block(6)).getByLabelText(/^Text/), { target: { value: 'Worth it.' } });
    await save();
    await waitFor(async () =>
      expect(await read('page/landing.md')).toContain(
        '      role: customer\n  - block: quote\n    text: Worth it.\n---',
      ),
    );
  });

  it('moves a block up and down, and removes one', async () => {
    const { read } = await openLanding();
    fireEvent.click(within(block(5)).getByRole('button', { name: 'Move Quote · Quick and painless. up' }));
    fireEvent.click(within(block(1)).getByRole('button', { name: /^Move Hero .* down$/ }));
    fireEvent.click(within(block(3)).getByRole('button', { name: 'Remove Text' }));
    expect(
      within(blocks())
        .getAllByRole('listitem')
        .filter((li) => li.parentElement === blocks())
        .map((li) => li.getAttribute('aria-label')!.split(' · ')[0]),
    ).toEqual(['1. Features', '2. Hero', '3. Quote', '4. Survey']);
    await save();
    await waitFor(async () => {
      const kinds = [...(await read('page/landing.md')).matchAll(/^ {2}- block: (\w+)$/gm)].map((m) => m[1]);
      expect(kinds).toEqual(['features', 'hero', 'quote', 'survey']);
    });
  });

  it('adds and removes items of a list of objects', async () => {
    const { read } = await openLanding();
    fireEvent.click(within(block(2)).getByRole('button', { name: 'Add items item' }));
    const features = () => within(block(2)).getByRole('list', { name: 'Items items' });
    const third = within(features()).getAllByRole('listitem')[2]!;
    fireEvent.change(within(third).getByLabelText(/^Title/), { target: { value: 'Paid' } });
    fireEvent.click(within(features()).getByRole('button', { name: 'Remove Item · Private' }));
    await save();
    await waitFor(async () =>
      expect(await read('page/landing.md')).toContain('        alt: Clock\n      - title: Paid\n  - block: prose'),
    );
  });

  it('shows a validation issue inside a block, at its field, and does not save', async () => {
    const { read } = await openLanding();
    const before = await read('page/landing.md');
    fireEvent.click(within(main()).getByRole('button', { name: 'Add block' }));
    fireEvent.click(
      within(within(main()).getByRole('group', { name: 'Content: block kinds' })).getByRole('button', { name: 'Hero' }),
    );
    const button = entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const title = within(block(6)).getByLabelText(/^Title/);
    await waitFor(() => expect(title.getAttribute('aria-invalid')).toBe('true'));
    expect(within(block(6)).getByRole('alert').textContent).toContain('Required');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await read('page/landing.md')).toBe(before);
    // Fixing it clears the issue, and the block saves.
    fireEvent.change(title, { target: { value: 'Second hero' } });
    await save();
    await waitFor(async () =>
      expect(await read('page/landing.md')).toContain('  - block: hero\n    title: Second hero\n---'),
    );
  });

  it('writes nothing for an object whose fields are all cleared', async () => {
    const { read } = await openLanding();
    const seo = within(main()).getByRole('group', { name: /^SEO/ });
    fireEvent.change(within(seo).getByLabelText(/^Title/), { target: { value: '' } });
    fireEvent.change(within(seo).getByLabelText(/^Description/), { target: { value: '' } });
    await save();
    await waitFor(async () => expect(await read('page/landing.md')).not.toContain('seo:'));
  });

  it('opens the survey a block references, which lists the page as a referrer', async () => {
    await openLanding();
    const surveyBlock = block(4);
    await waitFor(() =>
      expect((within(surveyBlock).getByRole('combobox', { name: /^Survey/ }) as HTMLInputElement).value).toBe(
        'Onboarding survey',
      ),
    );
    fireEvent.click(within(surveyBlock).getByRole('link', { name: 'Open Onboarding survey' }));
    await waitFor(() => expect(route()).toBe('survey/onboarding'));
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 1 entry' });
    expect(within(usedBy).getByText('page/landing · via content.3.survey')).toBeDefined();
  });

  it('uploads an image into a block, committed with the entry', async () => {
    const { file, read } = await openLanding();
    const input = screen.getByTestId('content.0.image-file') as HTMLInputElement;
    const upload = new File([new Uint8Array([1, 2, 3])], 'New Hero.webp', { type: 'image/webp' });
    fireEvent.change(input, { target: { files: [upload] } });
    await waitFor(() => expect(within(block(1)).getByTitle('landing/new-hero.webp')).toBeDefined());
    await save();
    await waitFor(async () => expect(await read('page/landing.md')).toContain('src: landing/new-hero.webp'));
    expect((await stat(file('page/landing/new-hero.webp'))).size).toBe(3);
  });

  it('edits an object inside an object (question scale labels)', async () => {
    const { source, read } = await site();
    renderApp({ source, route: 'question/rating' });
    const scale = await within(main()).findByRole('group', { name: /^Scale/ });
    const labels = within(scale).getByRole('group', { name: /^Labels/ });
    fireEvent.change(within(labels).getByLabelText(/^High end/), { target: { value: 'Definitely' } });
    await save();
    await waitFor(async () =>
      expect(await read('question/rating.md')).toContain('  labels:\n    low: Not at all\n    high: Definitely\n'),
    );
    expect(route()).toBe('question/rating');
  });
});
