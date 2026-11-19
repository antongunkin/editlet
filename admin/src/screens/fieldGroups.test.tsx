import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { findCta, fixtureFiles, renderApp, rowText, setField, sheet } from '../test/render';

// Field groups as tabs (spec 2026-11-19-admin-field-groups.md): the fixture's post with its image in *Media*.

function groupedFiles() {
  const files = fixtureFiles();
  const schema = JSON.parse(files['cms/schema.json'] as string);
  schema.collections.post.groups = { content: { label: 'Content' }, media: { label: 'Media' } };
  schema.collections.post.fields.featuredImage.group = 'media';
  files['cms/schema.json'] = JSON.stringify(schema);
  return files;
}

async function openPost() {
  renderApp({ route: 'post/hello-world', source: createMemorySource(groupedFiles()) });
  await screen.findByRole('button', { name: /^Title/ });
  return screen.getByRole('tablist', { name: 'Field groups' });
}

const row = (label: string) => screen.queryByRole('button', { name: new RegExp(`^${label}`) });

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Field groups', () => {
  it('shows a tab per group; the chosen one holds its rows', async () => {
    const tabs = await openPost();
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Content', 'Media']);
    expect(within(tabs).getByRole('tab', { name: 'Content' }).getAttribute('aria-selected')).toBe('true');
    expect(row('Featured image')).toBeNull();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Media' }));
    await waitFor(() => expect(row('Featured image')).not.toBeNull());
    expect(row('Title')).toBeNull();
  });

  it('marks a group with a changed field, and Fix opens the invalid field in its own tab', async () => {
    const tabs = await openPost();
    await setField('Title', '');
    expect(within(tabs).getByRole('tab', { name: 'Content, changed' })).toBeTruthy();
    fireEvent.click(await findCta('Save 1 change'));
    await waitFor(() => expect(rowText('Title')).toContain('Required'));
    expect(within(tabs).getByRole('tab', { name: 'Content, has errors' })).toBeTruthy();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Media' }));
    await waitFor(() => expect(row('Title')).toBeNull());
    fireEvent.click(await findCta('Fix 1 field'));
    const modal = await sheet('Title');
    expect(modal.getByRole('alert').textContent).toContain('Required');
    // The entry under the modal is hidden from assistive technology while it is open.
    const content = within(tabs).getByRole('tab', { name: 'Content, has errors', hidden: true });
    expect(content.getAttribute('aria-selected')).toBe('true');
  });

  it('draws no tab track without groups', async () => {
    renderApp({ route: 'post/hello-world', source: createMemorySource(fixtureFiles()) });
    await screen.findByRole('button', { name: /^Title/ });
    expect(screen.queryByRole('tablist', { name: 'Field groups' })).toBeNull();
    expect(row('Featured image')).not.toBeNull();
  });
});
