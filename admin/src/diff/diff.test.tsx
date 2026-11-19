import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DiffHunk } from './DiffHunk';
import { FieldDiff, InfoRow } from './FieldDiff';
import { reviewEntries, reviewSummary, ReviewDialog } from './ReviewDialog';

import type { FieldDiffRow } from '../entry/diff';

const row = (over: Partial<FieldDiffRow> = {}): FieldDiffRow => ({
  key: 'title',
  label: 'Title',
  type: 'string',
  before: 'Old',
  after: 'New',
  ...over,
});

const lines = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-editlet="diff-line"]')].map((l) => l.getAttribute('data-kind'));

describe('DiffHunk', () => {
  it('marks added, removed and kept lines, with line numbers on request', () => {
    const { container } = render(<DiffHunk before={'a\nb\nc\n'} after={'a\nB\nc\nd\n'} showLineNumbers />);
    expect(lines(container)).toEqual(['ctx', 'del', 'add', 'ctx', 'add']);
    expect(container.textContent).toContain('−b');
    expect(container.textContent).toContain('+B');
  });

  it('shows equal text as context, and nothing as No content', () => {
    const same = render(<DiffHunk before={'x\ny'} after={'x\ny'} />);
    expect(lines(same.container)).toEqual(['ctx', 'ctx']);
    same.unmount();
    const { container } = render(<DiffHunk before="" after="" />);
    // `''` splits into one empty context line.
    expect(lines(container)).toEqual(['ctx']);
  });
});

describe('FieldDiff', () => {
  it('draws a short change as the old value struck through and the new one', () => {
    render(<FieldDiff row={row()} />);
    const region = screen.getByRole('region', { name: 'Title' });
    expect(within(region).getByText('Old', { exact: false }).className).toContain('line-through');
    expect(region.textContent).toContain('Before: Old');
    expect(region.textContent).toContain('After: New');
  });

  it('leaves out an empty side, and says Empty when both are', () => {
    const { rerender } = render(<FieldDiff row={row({ before: '' })} />);
    expect(screen.getByRole('region', { name: 'Title' }).textContent).not.toContain('Before');
    rerender(<FieldDiff row={row({ after: '' })} />);
    expect(screen.getByRole('region', { name: 'Title' }).textContent).not.toContain('After');
    rerender(<FieldDiff row={row({ before: '', after: '' })} />);
    expect(screen.getByText('Empty')).toBeDefined();
  });

  it('turns a multi-line value into a line diff', () => {
    const { container } = render(<FieldDiff row={row({ type: 'markdown', before: 'a\nb', after: 'a\nc' })} />);
    expect(lines(container)).toEqual(['ctx', 'del', 'add']);
  });

  it('InfoRow is a plain row: a list item with its line and trail', () => {
    render(
      <ul>
        <InfoRow as="li" lead="file" title="cover.png" sub="New file" trail={<span>t</span>} />
      </ul>,
    );
    const item = screen.getByRole('listitem');
    expect(item.textContent).toBe('cover.pngNew filet');
  });
});

describe('Your changes', () => {
  const entries = reviewEntries('post/a', 'A post', 'Post', [row(), row({ key: 'excerpt', label: 'Excerpt' })]);

  it('summarises the commit and names the entry with its changed fields', () => {
    expect(entries[0]!.sub).toBe('Post · Title, Excerpt');
    expect(reviewSummary(entries, ['cms/a.png'])).toBe('1 entry, 2 fields, 1 new file');
    expect(reviewSummary([], [])).toBe('0 entries, 0 fields');
  });

  it('inline (600 px): the diffs under the entry, no row to open, the CTA saves', () => {
    const onConfirm = vi.fn();
    render(
      <ReviewDialog
        open
        onOpenChange={() => {}}
        entries={entries}
        newFiles={['cms/content/post/cover.png']}
        saveTo="editlet/spring · PR #2"
        confirmLabel="Save 2 changes"
        onConfirm={onConfirm}
        inline
      />,
    );
    const sheet = screen.getByRole('dialog', { name: 'Your changes' });
    expect(within(sheet).getByRole('region', { name: 'Excerpt' })).toBeDefined();
    expect(within(sheet).queryByRole('button', { name: /A post/ })).toBeNull();
    const commit = within(sheet).getByRole('list', { name: 'Commit' });
    expect(commit.textContent).toContain('New file · cms/content/post/cover.png');
    expect(within(commit).queryByRole('button')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save 2 changes' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('on main: the CTA and the Save to row open Save to, whose CTA saves', async () => {
    const onConfirm = vi.fn();
    render(
      <ReviewDialog
        open
        onOpenChange={() => {}}
        entries={entries}
        newFiles={[]}
        saveTo="main · new branch"
        newBranch={<input aria-label="New branch" defaultValue="post-a" />}
        confirmLabel="Save 2 changes"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Save to/ }));
    const saveTo = await screen.findByRole('dialog', { name: 'Save to' });
    expect(within(saveTo).getByRole('textbox', { name: 'New branch' })).toBeDefined();
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(saveTo).getByRole('button', { name: 'Save to new branch' })));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('a busy save locks the rows; nothing to review has no CTA', () => {
    const { rerender } = render(
      <ReviewDialog
        open
        onOpenChange={() => {}}
        entries={entries}
        newFiles={[]}
        confirmLabel="Save 2 changes"
        busy
        onConfirm={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: /A post/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Saving/ }).getAttribute('aria-busy')).toBe('true');
    rerender(
      <ReviewDialog open onOpenChange={() => {}} entries={[]} newFiles={[]} confirmLabel="Save" onConfirm={() => {}} />,
    );
    expect(screen.getByRole('heading', { name: 'No changes' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('Escape closes only the top level', () => {
  function Harness({ onMain }: { onMain?: boolean }) {
    const [open, setOpen] = useState(true);
    return (
      <ReviewDialog
        open={open}
        onOpenChange={setOpen}
        entries={reviewEntries('post/a', 'A post', 'Post', [row()])}
        newFiles={[]}
        saveTo={onMain ? 'main · new branch' : undefined}
        newBranch={onMain ? <input aria-label="New branch" /> : undefined}
        confirmLabel="Save 1 change"
        onConfirm={() => {}}
      />
    );
  }

  it('the entry’s diff, then Your changes', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /A post/ }));
    const diff = await screen.findByRole('dialog', { name: 'A post' });
    fireEvent.keyDown(diff, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'A post' })).toBeNull());
    const review = screen.getByRole('dialog', { name: 'Your changes' });
    fireEvent.keyDown(review, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull());
  });

  it('Save to, then Your changes', async () => {
    render(<Harness onMain />);
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    const saveTo = await screen.findByRole('dialog', { name: 'Save to' });
    fireEvent.keyDown(saveTo, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save to' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Your changes' })).toBeDefined();
  });
});
