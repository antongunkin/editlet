import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalSource } from './source/local';
import {
  closeSheets,
  doneField,
  findCta,
  openField,
  renderApp,
  rowText,
  saveReview,
  setField,
  sheet,
} from './test/render';

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
type Scope = ReturnType<typeof within>;

/** The rows of a list of items (`Content items`, `Items items`) in an open sheet. */
const itemRows = (scope: Scope, name: string) => within(scope.getByRole('list', { name })).getAllByRole('listitem');
const itemLabels = (scope: Scope, name: string) => itemRows(scope, name).map((li) => li.getAttribute('aria-label'));

/** Opens item `n` (1-based) of the list `list` in `scope`: the row's button that is not its grip. */
async function openItem(scope: Scope, list: string, n: number, sheetName: string) {
  const row = itemRows(scope, list)[n - 1]!;
  const open = within(row)
    .getAllByRole('button')
    .find((b) => b.getAttribute('data-slot') !== 'grip')!;
  fireEvent.click(open);
  return sheet(sheetName);
}

async function save() {
  await closeSheets();
  fireEvent.click(await findCta(/^Save/));
  await saveReview();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** Opens `page/landing` and its Content (the blocks) modal. */
async function openLanding() {
  const s = await site();
  renderApp({ source: s.source, route: 'page/landing' });
  await screen.findByRole('button', { name: /^Content/ });
  const content = await openField('Content');
  return { ...s, content };
}

describe('object and blocks in the admin, end to end', () => {
  it('shows every block as a row that opens its fields', async () => {
    const { content } = await openLanding();
    expect(itemLabels(content, 'Content items')).toEqual([
      '1. Hero',
      '2. Features',
      '3. Text',
      '4. Survey',
      '5. Quote',
    ]);
    // Each row names the block by its first text.
    expect(itemRows(content, 'Content items').map((li) => li.textContent)).toEqual([
      'HeroYour opinion, five minutes a month',
      'Features',
      'Text',
      'SurveyTakes five minutes.',
      'QuoteQuick and painless.',
    ]);
    // Fields of a block, and of an object inside it.
    const hero = await openItem(content, 'Content items', 1, 'Hero');
    expect(rowText('Title', hero)).toContain('Your opinion, five minutes a month');
    const button = await openField('Button', hero);
    expect(rowText('URL', button)).toContain('/survey/onboarding');
    await closeSheets();
    // A list of objects inside a block.
    const again = await openField('Content');
    const features = await openItem(again, 'Content items', 2, 'Features');
    expect(rowText('Items', features)).toContain('2 items');
    const items = await openField('Items', features);
    expect(itemRows(items, 'Items items').map((li) => li.textContent)).toEqual(['ItemFast', 'ItemPrivate']);
  });

  it('edits a field inside a block and inside a nested object, and saves only those lines', async () => {
    const { read, content } = await openLanding();
    const before = await read('page/landing.md');
    const hero = await openItem(content, 'Content items', 1, 'Hero');
    await setField('Title', 'Five minutes a month', hero);
    await doneField();
    const quote = await openItem(content, 'Content items', 5, 'Quote');
    const by = await openField('By', quote);
    await setField('Name', 'Jane Doe', by);
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
    const { read, content } = await openLanding();
    fireEvent.click(content.getByRole('button', { name: 'Add block' }));
    const kinds = (await sheet('Add block')).getByRole('group', { name: 'Content: block kinds' });
    fireEvent.click(within(kinds).getByRole('button', { name: 'Quote' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add block' })).toBeNull());
    expect(itemLabels(content, 'Content items')).toHaveLength(6);
    const quote = await openItem(content, 'Content items', 6, 'Quote');
    await setField('Text', 'Worth it.', quote);
    await save();
    await waitFor(async () =>
      expect(await read('page/landing.md')).toContain(
        '      role: customer\n  - block: quote\n    text: Worth it.\n---',
      ),
    );
  });

  it('moves a block up and down, and removes one', async () => {
    const { read, content } = await openLanding();
    const grip = (n: number) =>
      within(itemRows(content, 'Content items')[n - 1]!).getByRole('button', { name: /^Move / });
    fireEvent.keyDown(grip(5), { key: 'ArrowUp' });
    fireEvent.keyDown(grip(1), { key: 'ArrowDown' });
    const text = await openItem(content, 'Content items', 3, 'Text');
    fireEvent.click(text.getByRole('button', { name: 'Remove block' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Text' })).toBeNull());
    expect(itemLabels(content, 'Content items')).toEqual(['1. Features', '2. Hero', '3. Quote', '4. Survey']);
    await save();
    await waitFor(async () => {
      const kinds = [...(await read('page/landing.md')).matchAll(/^ {2}- block: (\w+)$/gm)].map((m) => m[1]);
      expect(kinds).toEqual(['features', 'hero', 'quote', 'survey']);
    });
  });

  it('adds and removes items of a list of objects', async () => {
    const { read, content } = await openLanding();
    const features = await openItem(content, 'Content items', 2, 'Features');
    const items = await openField('Items', features);
    fireEvent.click(items.getByRole('button', { name: 'Add items item' }));
    await waitFor(() => expect(itemRows(items, 'Items items')).toHaveLength(3));
    const third = await openItem(items, 'Items items', 3, 'Item');
    await setField('Title', 'Paid', third);
    await doneField();
    const second = await openItem(items, 'Items items', 2, 'Item');
    expect(rowText('Title', second)).toContain('Private');
    fireEvent.click(second.getByRole('button', { name: 'Remove item' }));
    await waitFor(() =>
      expect(itemRows(items, 'Items items').map((li) => li.textContent)).toEqual(['ItemFast', 'ItemPaid']),
    );
    await save();
    await waitFor(async () =>
      expect(await read('page/landing.md')).toContain('        alt: Clock\n      - title: Paid\n  - block: prose'),
    );
  });

  it('shows a validation issue inside a block, at its field, and does not save', async () => {
    const { read, content } = await openLanding();
    const before = await read('page/landing.md');
    fireEvent.click(content.getByRole('button', { name: 'Add block' }));
    fireEvent.click(
      within((await sheet('Add block')).getByRole('group', { name: 'Content: block kinds' })).getByRole('button', {
        name: 'Hero',
      }),
    );
    await closeSheets();
    fireEvent.click(await findCta(/^Save/));
    // The CTA says what blocks the save; the row, the block and the field say where.
    const fix = await findCta('Fix 1 field');
    expect(rowText('Content')).toContain('Required');
    fireEvent.click(fix);
    const blocks = await sheet('Content');
    expect(itemRows(blocks, 'Content items')[5]!.textContent).toContain('Check this');
    const hero = await openItem(blocks, 'Content items', 6, 'Hero');
    expect(rowText('Title', hero)).toContain('Required');
    const title = await openField('Title', hero);
    expect(title.getByRole('alert').textContent).toContain('Required');
    expect(title.getByLabelText(/^Title/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull();
    expect(await read('page/landing.md')).toBe(before);
    // Fixing it clears the issue, and the block saves.
    fireEvent.change(title.getByLabelText(/^Title/), { target: { value: 'Second hero' } });
    await doneField();
    expect(rowText('Title', hero)).not.toContain('Required');
    await save();
    await waitFor(async () =>
      expect(await read('page/landing.md')).toContain('  - block: hero\n    title: Second hero\n---'),
    );
  });

  it('writes nothing for an object whose fields are all cleared', async () => {
    const { read } = await openLanding();
    await closeSheets();
    const seo = await openField('SEO');
    await setField('Title', '', seo);
    await setField('Description', '', seo);
    await save();
    await waitFor(async () => expect(await read('page/landing.md')).not.toContain('seo:'));
  });

  it('opens the survey a block references, which lists the page as a referrer', async () => {
    const { content } = await openLanding();
    const surveyBlock = await openItem(content, 'Content items', 4, 'Survey');
    await waitFor(() => expect(rowText('Survey', surveyBlock)).toContain('Onboarding survey'));
    const field = await openField('Survey', surveyBlock);
    fireEvent.click(field.getByRole('link', { name: 'Open Onboarding survey' }));
    await waitFor(() => expect(route()).toBe('survey/onboarding'));
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 1 entry' });
    expect(within(usedBy).getByText('page/landing · via content.3.survey')).toBeDefined();
  });

  it('uploads an image into a block, committed with the entry', async () => {
    const { file, read, content } = await openLanding();
    const hero = await openItem(content, 'Content items', 1, 'Hero');
    const image = await openField('Image', hero);
    const input = image.getByTestId('content.0.image-file') as HTMLInputElement;
    const upload = new File([new Uint8Array([1, 2, 3])], 'New Hero.webp', { type: 'image/webp' });
    fireEvent.change(input, { target: { files: [upload] } });
    await waitFor(() => expect(image.getByText('new-hero.webp · uploads when you save')).toBeDefined());
    await save();
    await waitFor(async () => expect(await read('page/landing.md')).toContain('src: landing/new-hero.webp'));
    expect((await stat(file('page/landing/new-hero.webp'))).size).toBe(3);
  });

  it('edits an object inside an object (question scale labels)', async () => {
    const { source, read } = await site();
    renderApp({ source, route: 'question/rating' });
    await screen.findByRole('button', { name: /^Scale/ });
    const scale = await openField('Scale');
    const labels = await openField('Labels', scale);
    await setField('High end', 'Definitely', labels);
    await save();
    await waitFor(async () =>
      expect(await read('question/rating.md')).toContain('  labels:\n    low: Not at all\n    high: Definitely\n'),
    );
    expect(route()).toBe('question/rating');
  });
});
