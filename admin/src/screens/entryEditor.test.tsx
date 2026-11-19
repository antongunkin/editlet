import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEntryEditor, EntryEditorFrame } from './EntryEditor';
import { EntryLoader, type LoadedEntry } from './EntryLoader';

import { createMemorySource } from '../../../core/source';
import { ChangesProvider } from '../changes/ChangesProvider';
import { SourceProvider } from '../source/context';
import { createTestQueryClient, fixtureFiles, saveReview } from '../test/render';
import { BridgeProvider } from '../useRoute';

// The page preview's form map, keyed by ref: what each editor wrote last (`null` = dropped).
const forms = new Map<string, unknown>();
const refreshSite = vi.fn(async () => {});
vi.mock('../preview/PreviewProvider', async (original) => ({
  ...(await original<typeof import('../preview/PreviewProvider')>()),
  usePreview: () => ({
    setFormPreview: (ref: string, fields: unknown) => forms.set(ref, fields),
    setBufferPreview: () => {},
    setBranchPreview: () => {},
    setRefreshSite: () => {},
    setNotice: () => {},
  }),
  useSiteRefresh: () => refreshSite,
}));

afterEach(() => {
  forms.clear();
  refreshSite.mockClear();
});

/** A bare form of one entry: its notices and banners, its dirty state, a button that edits its title field, Save. */
function Form({
  entry,
  field,
  prefix,
  mounts,
}: {
  entry: LoadedEntry;
  field: string;
  prefix?: string;
  mounts: Map<string, number>;
}) {
  const editor = useEntryEditor({ entry, prefix });
  const { ref } = editor;
  useEffect(() => {
    mounts.set(ref, (mounts.get(ref) ?? 0) + 1);
  }, [mounts, ref]);
  return (
    <EntryEditorFrame editor={editor}>
      <section aria-label={editor.ref}>
        {entry.notices}
        {editor.issueBanners}
        <p>{editor.dirty ? 'Dirty' : 'Clean'}</p>
        <p>Names: {editor.items.map((i) => i.name).join(', ')}</p>
        <button type="button" onClick={() => editor.form.setFieldValue(field, `${String(editor.values[field])}!`)}>
          Edit
        </button>
        <button type="button" onClick={editor.onSave}>
          {editor.saveLabel}
        </button>
      </section>
      {editor.dialogs}
    </EntryEditorFrame>
  );
}

function Editor({
  collection,
  slug,
  field,
  prefix,
  mounts,
}: {
  collection: string;
  slug: string;
  field: string;
  prefix?: string;
  mounts: Map<string, number>;
}) {
  return (
    <EntryLoader collection={collection} slug={slug} renderFallback={() => <p>Loading {slug}</p>}>
      {(entry) => <Form entry={entry} field={field} prefix={prefix} mounts={mounts} />}
    </EntryLoader>
  );
}

/** A source whose commits can be held until `release()`, to type while a save is pending. */
function gatedSource() {
  const source = createMemorySource(fixtureFiles());
  let held = false;
  let waiting: (() => void) | null = null;
  const commit = source.commit.bind(source);
  source.commit = async (changes, message) => {
    if (held) await new Promise<void>((resolve) => (waiting = resolve));
    return commit(changes, message);
  };
  const gate = {
    hold: () => {
      held = true;
    },
    pending: () => waiting !== null,
    release: () => {
      held = false;
      waiting?.();
      waiting = null;
    },
  };
  return { source, gate };
}

function renderTwo() {
  const { source, gate } = gatedSource();
  const mounts = new Map<string, number>();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SourceProvider source={source}>
        <BridgeProvider>
          <ChangesProvider>
            <Editor collection="post" slug="hello-world" field="title" mounts={mounts} />
            <Editor collection="author" slug="jane" field="name" prefix="on-top:author/jane:" mounts={mounts} />
          </ChangesProvider>
        </BridgeProvider>
      </SourceProvider>
    </QueryClientProvider>,
  );
  return { source, mounts, gate };
}

const region = (name: string) => within(screen.getByRole('region', { name }));

describe('two editors side by side (EntryLoader + EntryEditor)', () => {
  it('keeps two refs in the preview, two dirty states, and prefixed names', async () => {
    renderTwo();
    await screen.findByRole('region', { name: 'post/hello-world' });
    await screen.findByRole('region', { name: 'author/jane' });
    expect(region('author/jane').getByText(/^Names:/).textContent).toBe('Names: on-top:author/jane:name');
    expect(region('post/hello-world').getByText(/^Names:/).textContent).toContain('Names: title,');

    fireEvent.click(region('author/jane').getByRole('button', { name: 'Edit' }));
    expect(region('author/jane').getByText('Dirty')).toBeDefined();
    expect(region('post/hello-world').getByText('Clean')).toBeDefined();
    fireEvent.click(region('post/hello-world').getByRole('button', { name: 'Edit' }));
    expect(region('post/hello-world').getByText('Dirty')).toBeDefined();
    await waitFor(() => {
      // Each ref holds its own field change, and nothing of the other's.
      expect(forms.get('author/jane')).toMatchObject({ name: { text: { to: expect.stringMatching(/!$/) } } });
      expect(forms.get('post/hello-world')).toMatchObject({ title: { text: { to: expect.stringMatching(/!$/) } } });
      expect(forms.get('author/jane')).not.toHaveProperty('title');
      expect(forms.get('post/hello-world')).not.toHaveProperty('name');
    });
  });

  it('saves the second editor alone: its own file, no changed-on-disk notice, the first keeps its edit', async () => {
    const { source, mounts, gate } = renderTwo();
    await screen.findByRole('region', { name: 'author/jane' });
    await screen.findByRole('region', { name: 'post/hello-world' });
    fireEvent.click(region('post/hello-world').getByRole('button', { name: 'Edit' }));
    fireEvent.click(region('author/jane').getByRole('button', { name: 'Edit' }));
    fireEvent.click(await region('author/jane').findByRole('button', { name: 'Save 1 change' }));
    // The commit is held: the editor types again while it is pending, so its form is still dirty when the new
    // file lands, and only the loader's own-commit rule (`onCommitStart`) lets it adopt that file.
    await waitFor(() => expect(mounts.size).toBe(2));
    const before = new Map(mounts);
    gate.hold();
    await saveReview();
    await waitFor(() => expect(gate.pending()).toBe(true));
    // The review sheet is open over the page: its siblings are aria-hidden.
    fireEvent.click(
      within(screen.getByRole('region', { name: 'author/jane', hidden: true })).getByRole('button', {
        name: 'Edit',
        hidden: true,
      }),
    );
    await act(async () => gate.release());
    await waitFor(() => expect(mounts.get('author/jane')).toBeGreaterThan(before.get('author/jane')!));
    const saved = new TextDecoder().decode(await source.readFile('cms/content/author/jane.md'));
    expect(saved).toMatch(/name: .*!/);
    // The saved file landed (a new sha) and was adopted as this editor's own commit, not reported as a change on disk;
    // the other editor's form was not remounted and keeps its edit.
    expect(region('author/jane').queryByText(/changed on disk/)).toBeNull();
    expect(mounts.get('post/hello-world')).toBe(before.get('post/hello-world'));
    expect(region('post/hello-world').getByText('Dirty')).toBeDefined();
    expect(refreshSite).toHaveBeenCalledTimes(1);
  });
});
