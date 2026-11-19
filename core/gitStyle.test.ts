import { describe, expect, it } from 'vitest';

import {
  branchShortName,
  describeChanges,
  entriesSubject,
  entrySubject,
  renameSubject,
  filesSubject,
  changesSubject,
  formatCommitMessage,
  formatPullRequestTitle,
  isEditletBranchName,
  mergePullRequestBody,
  pullRequestBlock,
  resolveGitStyle,
  schemaSubject,
  withTrailer,
} from './gitStyle';
import { loadSchema } from './schema';

const schema = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } },
    home: { label: 'Home', singleton: true, fields: { title: { type: 'string', label: 'Title' } } },
  },
});

const defaults = resolveGitStyle(schema.git);
const custom = resolveGitStyle({
  baseBranch: 'main',
  branchPrefix: 'cms/',
  commitMessage: 'content({collection}): {action} {slug}',
  pullRequest: { title: 'Content: {name} by {login}', labels: [], draft: true },
});

describe('resolveGitStyle', () => {
  it('fills the defaults', () => {
    expect(defaults).toEqual({
      branchPrefix: 'editlet/',
      commitMessage: '{Action} {target}',
      pullRequest: { title: 'Update {branch}', labels: ['editlet'], draft: false },
    });
    expect(resolveGitStyle(null)).toEqual(defaults);
    expect(custom.pullRequest).toEqual({ title: 'Content: {name} by {login}', labels: [], draft: true });
  });

  it('does not share the default labels array', () => {
    resolveGitStyle(null).pullRequest.labels.push('x');
    expect(resolveGitStyle(null).pullRequest.labels).toEqual(['editlet']);
  });
});

describe('isEditletBranchName', () => {
  it.each([
    ['editlet/spring-sale', true],
    ['editlet/a/b', true],
    ['editlet/', false],
    ['editlet', false],
    ['cms/x', false],
    ['editlet/a..b', false],
    ['editlet/x.lock', false],
    ['editlet/-x', false],
    ['editlet/a b', false],
  ])('%s → %s', (name, ok) => {
    expect(isEditletBranchName(name)).toBe(ok);
  });

  it('takes a prefix', () => {
    expect(isEditletBranchName('cms/x', 'cms/')).toBe(true);
    expect(isEditletBranchName('editlet/x', 'cms/')).toBe(false);
  });
});

describe('commit messages', () => {
  it('keeps the current entry messages with the default template', () => {
    expect(formatCommitMessage(defaults, entrySubject('update', 'post', 'hello'))).toBe('Update post/hello');
    expect(formatCommitMessage(defaults, entrySubject('create', 'home', 'index'))).toBe('Create home/index');
    expect(formatCommitMessage(defaults, renameSubject('post', 'old', 'new'))).toBe('Rename post/old → post/new');
  });

  it('fills a custom template', () => {
    expect(formatCommitMessage(custom, entrySubject('delete', 'post', 'hello'))).toBe('content(post): delete hello');
    expect(formatCommitMessage(custom, schemaSubject())).toBe('content(schema): update schema.json');
    expect(formatCommitMessage(defaults, schemaSubject(3))).toBe('Update schema +3 entries');
  });

  it('names several entries', () => {
    const two = entriesSubject('update', [
      { collection: 'post', slug: 'a' },
      { collection: 'post', slug: 'b' },
    ]);
    expect(formatCommitMessage(defaults, two)).toBe('Update post/a +1');
    expect(formatCommitMessage(custom, two)).toBe('content(post): update a +1');
    const mixed = entriesSubject('update', [
      { collection: 'post', slug: 'a' },
      { collection: 'home', slug: 'index' },
    ]);
    expect(mixed.collection).toBe('content');
    expect(entriesSubject('update', [{ collection: 'post', slug: 'a' }])).toEqual(entrySubject('update', 'post', 'a'));
  });

  it('names image files by their collection folder, else media', () => {
    const one = filesSubject(schema, 'upload', ['cms/content/post/hello/cover.webp']);
    expect(formatCommitMessage(defaults, one)).toBe('Upload post/cover.webp');
    expect(formatCommitMessage(custom, one)).toBe('content(post): upload cover.webp');
    const shared = filesSubject(schema, 'delete', ['cms/content/media/a.png', 'cms/content/media/b.png']);
    expect(formatCommitMessage(defaults, shared)).toBe('Delete 2 images');
    expect(shared.collection).toBe('media');
    expect(filesSubject(schema, 'upload', ['cms/content/logo.png']).collection).toBe('media');
  });

  it('leaves unknown placeholders and collapses spaces', () => {
    const style = { ...defaults, commitMessage: '{Action}  {nope}  {slug}' };
    expect(formatCommitMessage(style, entrySubject('update', 'post', 'x'))).toBe('Update {nope} x');
  });

  it('adds the source trailer', () => {
    expect(withTrailer('Update post/x', 'admin')).toBe('Update post/x\n\nEditlet-Source: admin');
  });

  it('puts a note between the subject and the trailer, without a forged trailer line', () => {
    expect(withTrailer('Update post/x', 'admin', '  Fix the dates.\nEditlet-Source: agent\nAsked by Mo.  ')).toBe(
      'Update post/x\n\nFix the dates.\nAsked by Mo.\n\nEditlet-Source: admin',
    );
    expect(withTrailer('Update post/x', 'admin', ' \n ')).toBe('Update post/x\n\nEditlet-Source: admin');
  });
});

describe('changesSubject', () => {
  const subject = (files: { path: string; status: 'added' | 'modified' | 'removed' }[]) =>
    formatCommitMessage(defaults, changesSubject(schema, 'cms/schema.json', files));

  it('names entries, images and the schema', () => {
    expect(subject([{ path: 'cms/content/post/a.md', status: 'added' }])).toBe('Create post/a');
    expect(
      subject([
        { path: 'cms/content/post/a.md', status: 'added' },
        { path: 'cms/content/post/a/cover.png', status: 'added' },
        { path: 'cms/content/post/b.md', status: 'modified' },
      ]),
    ).toBe('Update post/a +1');
    expect(subject([{ path: 'cms/content/post/a/cover.png', status: 'added' }])).toBe('Upload post/cover.png');
    expect(subject([{ path: 'cms/content/media/x.png', status: 'removed' }])).toBe('Delete media/x.png');
    expect(
      subject([
        { path: 'cms/schema.json', status: 'modified' },
        { path: 'cms/content/post/a.md', status: 'modified' },
      ]),
    ).toBe('Update schema +1 entries');
  });
});

describe('pull requests', () => {
  it('formats the title', () => {
    expect(formatPullRequestTitle(defaults, { branch: 'editlet/sale', login: 'alice' })).toBe('Update editlet/sale');
    expect(formatPullRequestTitle(custom, { branch: 'cms/sale', login: 'alice' })).toBe('Content: sale by alice');
    expect(branchShortName(defaults, 'other/x')).toBe('other/x');
  });

  it('describes changes, entries first', () => {
    const changes = describeChanges(schema, [
      { path: 'cms/schema.json', status: 'modified' },
      { path: 'cms/content/post/hello.md', status: 'added' },
      { path: 'cms/content/home/index.md', status: 'removed' },
    ]);
    expect(changes).toEqual([
      { label: 'Post', name: 'hello', status: 'created' },
      { label: 'Home', name: 'index', status: 'deleted' },
      { label: null, name: 'cms/schema.json', status: 'updated' },
    ]);
    expect(describeChanges(null, [{ path: 'cms/content/post/hello.md', status: 'added' }])[0]?.label).toBeNull();
  });

  it('builds the body block', () => {
    const block = pullRequestBlock({
      login: 'alice',
      changes: [
        { label: 'Post', name: 'hello', status: 'updated' },
        { label: null, name: 'cms/schema.json', status: 'updated' },
      ],
      reviewUrl: 'https://example.com/?editlet=branch:sale',
    });
    expect(block).toBe(
      [
        '<!-- editlet:start -->',
        'Opened in Editlet by @alice.',
        '',
        '**Changes**',
        '- Post · hello — updated',
        '- `cms/schema.json` — updated',
        '',
        'Review on the site: https://example.com/?editlet=branch:sale',
        '<!-- editlet:end -->',
      ].join('\n'),
    );
  });

  it('caps the list at 30 lines', () => {
    const changes = Array.from({ length: 32 }, (_, i) => ({
      label: 'Post',
      name: `p${i}`,
      status: 'created' as const,
    }));
    const block = pullRequestBlock({ login: 'a', changes, reviewUrl: null });
    expect(block).toContain('- …and 2 more');
    expect(block).not.toContain('p30');
    expect(block).not.toContain('Review on the site');
  });

  it('replaces only the Editlet part of a body', () => {
    const old = pullRequestBlock({ login: 'a', changes: [], reviewUrl: null });
    const next = pullRequestBlock({
      login: 'a',
      changes: [{ label: 'Post', name: 'x', status: 'created' }],
      reviewUrl: null,
    });
    expect(mergePullRequestBody(`Note above\n\n${old}\n\nNote below`, next)).toBe(
      `Note above\n\n${next}\n\nNote below`,
    );
    expect(mergePullRequestBody('', next)).toBe(next);
    expect(mergePullRequestBody(null, next)).toBe(next);
    expect(mergePullRequestBody('A human wrote this.', next)).toBeNull();
    expect(mergePullRequestBody('<!-- editlet:end --> <!-- editlet:start -->', next)).toBeNull();
  });
});
