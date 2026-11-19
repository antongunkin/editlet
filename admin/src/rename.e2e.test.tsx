import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalSource } from './source/local';
import { moreAction, moreActions, openField, renderApp, rowText, setField } from './test/render';

import { createDevHandler } from '../../node/devHandler';

const survey = join(import.meta.dirname, '../../__fixtures__/survey');
const temps: string[] = [];

// Each case is a long flow over the real dev handler and disk: allow for a slow machine.
configure({ asyncUtilTimeout: 10_000 });

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The admin against the real dev handler on a temp copy of the survey fixture (no network, real disk). */
async function site(route: string) {
  const root = await mkdtemp(join(tmpdir(), 'editlet-rename-'));
  temps.push(root);
  await cp(survey, root, { recursive: true });
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  renderApp({ source: createLocalSource({ fetch }), route });
  const file = (name: string) => join(root, 'cms/content', name);
  return {
    file,
    read: (name: string) => readFile(file(name), 'utf8'),
    exists: (name: string) =>
      stat(file(name)).then(
        () => true,
        () => false,
      ),
  };
}

const main = () => screen.getByRole('main');
const route = () => new URLSearchParams(window.location.search).get('editlet');

/** Opens the More actions item `name` once the entry's Used by (if any) has loaded. */
async function menu(name: string, usedBy?: string) {
  if (usedBy) await within(main()).findByRole('region', { name: usedBy });
  else await screen.findByRole('button', { name: /^Prompt|^Title/ });
  await moreAction(name);
  return screen.findByRole('alertdialog');
}

describe('rename and delete with references, end to end', () => {
  it('Rename opens with the focus in the slug field; Delete opens with it on Cancel', async () => {
    await site('question/role');
    const rename = await menu('Rename…', 'Used by 2 entries');
    await waitFor(() => expect(document.activeElement).toBe(within(rename).getByLabelText('New slug')));
    fireEvent.click(within(rename).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const del = await menu('Delete…', 'Used by 2 entries');
    await waitFor(() => expect(document.activeElement).toBe(within(del).getByRole('button', { name: 'Cancel' })));
  });

  it('renames an entry: new file, moved image folder, references rewritten, one commit', async () => {
    const { read, exists } = await site('question/role');
    const dialog = await menu('Rename…', 'Used by 2 entries');
    const input = within(dialog).getByLabelText('New slug');
    fireEvent.change(input, { target: { value: 'age' } });
    expect(within(dialog).getByText('question/age is taken')).toBeDefined();
    expect((within(dialog).getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'team-role' } });
    const plan = within(dialog).getByRole('list', { name: 'Rename plan' });
    expect([...plan.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'cms/content/question/role.md → cms/content/question/team-role.md',
      'Moves 1 file to cms/content/question/team-role/',
      'Updates section/about-you (references)',
      'Updates option/rating-high (references)',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(route()).toBe('question/team-role'));
    await waitFor(async () => expect(await exists('question/team-role.md')).toBe(true));
    expect(await exists('question/role.md')).toBe(false);
    expect(await exists('question/team-role/diagram.webp')).toBe(true);
    expect(await exists('question/role/diagram.webp')).toBe(false);
    expect(await read('question/team-role.md')).toContain('  src: team-role/diagram.webp\n');
    expect(await read('section/about-you.md')).toContain('  - question/team-role\n');
    expect(await read('option/rating-high.md')).toContain('followUp: question/team-role\n');
    // The renamed entry opens with its references and image in place.
    const usedBy = await within(main()).findByRole('region', { name: 'Used by 2 entries' });
    expect(within(usedBy).getByRole('link', { name: /^About you / })).toBeDefined();
    await waitFor(() => expect(rowText('Image')).toContain('diagram.webp'));
    expect((await openField('Image')).getByRole('button', { name: 'Replace' })).toBeDefined();
  });

  it('refuses Rename while the form has unsaved changes', async () => {
    await site('question/role');
    await screen.findByRole('button', { name: /^Prompt/ });
    await setField('Prompt', 'Changed');
    const item = (await moreActions()).getByRole('button', { name: /^Rename…/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain('Save or discard your changes first');
  });

  it('has no Rename for a singleton', async () => {
    await site('brand/index');
    await screen.findByRole('button', { name: /^Name/ });
    const actions = await moreActions();
    expect(actions.getByRole('button', { name: 'Delete…' })).toBeDefined();
    expect(actions.queryByRole('button', { name: /^Rename/ })).toBeNull();
  });

  it('deletes an entry and removes the references to it in one commit', async () => {
    const { read, exists } = await site('question/rating');
    const dialog = await menu('Delete…', 'Used by 2 entries');
    const confirm = () => within(dialog).getByRole('button', { name: /^Delete/ }) as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Also remove the references from 2 entries' }));
    expect(confirm().textContent).toBe('Delete and update 2');
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(route()).toBe('question'));
    await waitFor(async () => expect(await exists('question/rating.md')).toBe(false));
    expect(await read('question/role.md')).not.toContain('next:');
    expect(await read('section/feedback.md')).not.toContain('questions:');
  });

  it('does not delete when removing the references would break another entry', async () => {
    const { exists } = await site('survey/onboarding');
    const dialog = await menu('Delete…', 'Used by 1 entry');
    expect(within(dialog).getByRole('alert').textContent).toContain('page/landing: content.3.survey — Required');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect((within(dialog).getByRole('button', { name: /^Delete/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(await exists('survey/onboarding.md')).toBe(true);
  });
});
