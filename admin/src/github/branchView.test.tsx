import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BranchesSheet, NewBranchSheet } from './BranchesSheet';
import { BranchUnavailable, ChangesSheet, OtherFilesSheet } from './BranchView';
import { PreviewStep } from './DeployStatus';

import type { DeploymentInfo } from '../../../github';

const deployment = (over: Partial<DeploymentInfo>): DeploymentInfo => ({
  id: 1,
  sha: 'head',
  ref: 'editlet/a',
  environment: 'Preview',
  state: 'success',
  url: 'https://preview.example.com',
  logUrl: 'https://ci.example.com/log',
  createdAt: '2026-11-18T10:00:00Z',
  updatedAt: '2026-11-18T10:00:00Z',
  ...over,
});

const step = (d: DeploymentInfo | null | undefined) =>
  render(<PreviewStep deployment={d} expectSha="head" previewRoute="branch:a" />);

describe('the Preview step', () => {
  it('says what the deployment is doing, with its link', () => {
    const loading = step(undefined);
    expect(loading.container.textContent).toContain('Checking deployments…');
    expect(loading.container.textContent).toContain('In progress');
    loading.unmount();

    const failed = step(deployment({ state: 'failure' }));
    expect(failed.container.textContent).toContain('Preview build failed');
    expect(screen.getByRole('link', { name: 'Build log' }).getAttribute('href')).toBe('https://ci.example.com/log');
    failed.unmount();

    const older = step(deployment({ sha: 'old' }));
    expect(older.container.textContent).toContain('Build in progress');
    expect(screen.getByRole('link', { name: 'Older preview' })).toBeDefined();
    older.unmount();

    const none = step(null);
    expect(none.container.textContent).toContain('No preview yet');
    expect(none.container.textContent).toContain('To do');
  });

  it('a failed build without a log link is text only', () => {
    step(deployment({ state: 'error', logUrl: null }));
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('the branch screen sheets', () => {
  it('Other files: one row per path with its change, and the 300-file note', () => {
    render(
      <OtherFilesSheet
        open
        onOpenChange={() => {}}
        files={[
          { path: 'src/a.ts', status: 'added' },
          { path: 'src/b.ts', status: 'removed' },
          { path: 'src/c.ts', status: 'renamed' },
          { path: 'src/d.ts', status: 'modified' },
        ]}
        complete={false}
      />,
    );
    const list = screen.getByRole('list', { name: 'Other files' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['src/a.tsAdded', 'src/b.tsRemoved', 'src/c.tsRenamed', 'src/d.tsModified']);
    expect(screen.getByText('GitHub listed only the first 300 files.')).toBeDefined();
  });

  it('Changes: an entry with no field changes, a text file, an image and a binary file', () => {
    render(
      <ChangesSheet
        open
        onOpenChange={() => {}}
        sub="4 files"
        files={[
          { kind: 'entry', path: 'cms/content/post/a.md', status: 'modified', ref: 'post/a', rows: [] },
          { kind: 'text', path: 'cms/schema.json', status: 'modified', before: '{\n}', after: '{\n "a": 1\n}' },
          { kind: 'binary', path: 'cms/content/post/a.png', status: 'added', image: true },
          { kind: 'binary', path: 'cms/content/post/a.bin', status: 'removed', image: false },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'cms/content/post/a.md' }).textContent).toContain('No field changes');
    expect(screen.getByRole('region', { name: 'cms/schema.json' }).querySelectorAll('[data-kind="add"]')).toHaveLength(
      1,
    );
    expect(screen.getByRole('region', { name: 'cms/content/post/a.png' }).textContent).toContain('Image added');
    expect(screen.getByRole('region', { name: 'cms/content/post/a.bin' }).textContent).toContain('Binary file removed');
  });

  it('Changes with nothing changed says so', () => {
    render(<ChangesSheet open onOpenChange={() => {}} sub="0 files" files={[]} />);
    expect(screen.getByText('No content files changed.')).toBeDefined();
  });

  it('a branch route the admin cannot show says why', () => {
    render(<BranchUnavailable title="Not a CMS branch" text="x is not a branch the CMS edits." banners={<p>b</p>} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Not a CMS branch' })).toBeDefined();
    expect(screen.getByText('b')).toBeDefined();
  });
});

describe('Branches and New branch', () => {
  it('Enter in the find field opens New branch for a new name; the badge shows on other rows', () => {
    const onOpen = vi.fn();
    render(
      <BranchesSheet
        open
        onOpenChange={() => {}}
        query="new"
        onQuery={() => {}}
        branches={[
          { name: 'main', sub: 'Live site', active: true, onChoose: () => {} },
          { name: 'editlet/a', sub: 'Draft pull request #1', active: false, badge: <b>Draft</b>, onChoose: () => {} },
        ]}
        create={{ name: 'editlet/new', base: 'main', onOpen }}
        note={<output>Loading branches…</output>}
      />,
    );
    expect(screen.getByRole('button', { name: /^editlet\/a/ }).textContent).toContain('Draft');
    fireEvent.submit(screen.getByRole('searchbox', { name: 'Find or create a branch' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText('Loading branches…')).toBeDefined();
  });

  it('New branch: an invalid name cannot be created; GitHub’s answer is shown', () => {
    const onCreate = vi.fn();
    render(
      <NewBranchSheet
        open
        onOpenChange={() => {}}
        prefix="editlet/"
        value="!"
        onChange={() => {}}
        hint="Use letters, digits and dashes"
        invalid
        error="A branch with this name already exists"
        onCreate={onCreate}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Branch name' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('already exists');
    fireEvent.submit(input);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
