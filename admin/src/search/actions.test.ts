import { describe, expect, it, vi } from 'vitest';

import {
  buildActions,
  contextActions,
  searchActions,
  topResult,
  type ActionInput,
  type ScreenAction,
  type SearchAction,
} from './actions';
import { searchEntries, type SearchEntry } from './match';

import { loadSchema } from '../../../core/schema';

// The search's actions (docs/admin/search.md#actions): which ones a screen gets, how they match, the top-result rule.

const schema = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } },
    tag: { label: 'Tag', fields: { name: { type: 'string', label: 'Name' } } },
    homePage: { label: 'Home page', singleton: true, fields: { title: { type: 'string', label: 'Title' } } },
  },
});

const files = [
  { path: 'cms/content/post/a.md', sha: '1' },
  { path: 'cms/content/post/b.md', sha: '2' },
  { path: 'cms/content/tag/x.md', sha: '3' },
  { path: 'cms/content/homePage/index.md', sha: '4' },
];

const duplicate = (over: Partial<ScreenAction> = {}): ScreenAction => ({
  id: 'duplicate',
  label: 'Duplicate this entry',
  sub: 'Hello',
  icon: 'copy',
  keywords: ['duplicate', 'copy', 'clone'],
  run: vi.fn(),
  ...over,
});

const build = (over: Partial<ActionInput> = {}) =>
  buildActions({ schema, files, branch: null, route: { kind: 'home' }, theme: 'system', screenActions: [], ...over });

const ids = (actions: readonly SearchAction[]) => actions.map((a) => a.id);

describe('buildActions', () => {
  it('offers New per collection but a singleton, the places, and the two other Appearance choices', () => {
    expect(ids(build())).toEqual([
      'go:post',
      'go:tag',
      'go:homePage',
      'go:media',
      'go:schema',
      'go:content',
      'new:post',
      'new:tag',
      'theme:dark',
      'theme:light',
    ]);
  });

  it('names New with the collection’s noun and a place as All content names it, with its count', () => {
    const actions = build();
    expect(actions.find((a) => a.id === 'new:post')).toMatchObject({ label: 'New post', sub: 'Post' });
    expect(actions.find((a) => a.id === 'go:post')).toMatchObject({ label: 'Post', sub: 'Collection · 2 entries' });
    expect(actions.find((a) => a.id === 'go:tag')?.sub).toBe('Collection · 1 entry');
    expect(actions.find((a) => a.id === 'go:homePage')?.sub).toBe('Single page');
    expect(build({ files: undefined }).find((a) => a.id === 'go:post')?.sub).toBe('Collection');
  });

  it('leaves out the place already open and the current appearance', () => {
    const actions = build({ route: { kind: 'media' }, theme: 'dark' });
    expect(ids(actions)).not.toContain('go:media');
    expect(ids(actions)).toEqual(expect.arrayContaining(['theme:light', 'theme:system']));
    expect(ids(actions)).not.toContain('theme:dark');
  });

  it('offers Switch branch only in GitHub mode, with the active branch', () => {
    expect(ids(build())).not.toContain('switch-branch');
    expect(build({ branch: 'editlet/spring' }).find((a) => a.id === 'switch-branch')).toMatchObject({
      label: 'Switch branch…',
      sub: 'editlet/spring',
    });
  });

  it('puts the screen’s own actions first', () => {
    expect(build({ screenActions: [duplicate()] })[0]).toMatchObject({ id: 'duplicate', context: true });
  });
});

describe('contextActions (the empty field)', () => {
  it('Home: Switch branch… in GitHub mode, else none', () => {
    expect(contextActions(build())).toEqual([]);
    expect(ids(contextActions(build({ branch: 'main' })))).toEqual(['switch-branch']);
  });

  it('an entry: Duplicate, then New of its collection', () => {
    const route = { kind: 'entry', collection: 'post', slug: 'a' } as const;
    expect(ids(contextActions(build({ route, branch: 'main', screenActions: [duplicate()] })))).toEqual([
      'duplicate',
      'new:post',
    ]);
  });

  it('a collection: its New; Media and the model: none', () => {
    expect(ids(contextActions(build({ route: { kind: 'collection', collection: 'tag' } })))).toEqual(['new:tag']);
    expect(contextActions(build({ route: { kind: 'media' } }))).toEqual([]);
    expect(contextActions(build({ route: { kind: 'schema' } }))).toEqual([]);
  });
});

describe('searchActions', () => {
  const actions = build({ screenActions: [duplicate()] });
  const found = (query: string) => ids(searchActions(actions, query).map((r) => r.action));

  it('matches keywords: dark, theme, copy, new', () => {
    expect(found('dark')).toEqual(['theme:dark']);
    expect(found('theme')).toEqual(['theme:dark', 'theme:light']);
    expect(found('copy')).toEqual(['duplicate']);
    expect(found('new')).toEqual(['new:post', 'new:tag']);
    expect(found('new tag')[0]).toBe('new:tag');
    expect(found('media')[0]).toBe('go:media');
  });

  it('lists at most five', () => {
    expect(found('go')).toHaveLength(5);
  });
});

const entry = (title: string, slug: string): SearchEntry => ({
  collection: 'post',
  collectionLabel: 'Post',
  slug,
  title,
  draft: false,
});

describe('topResult', () => {
  const actions = build();
  const top = (entries: SearchEntry[], query: string, list = actions) =>
    topResult(searchEntries(entries, query), searchActions(list, query), query);

  it('is the best-ranked row of either group', () => {
    expect(top([entry('Darkroom notes', 'darkroom')], 'dark')).toMatchObject({ kind: 'action' });
    expect(top([entry('Tires', 'tires')], 'tires')).toMatchObject({ kind: 'entry' });
    expect(top([], 'dark')).toMatchObject({ kind: 'action', action: { id: 'theme:dark' } });
  });

  it('a bare collection noun opens the collection, not its New dialog', () => {
    expect(top([], 'post')).toMatchObject({ kind: 'action', action: { id: 'go:post' } });
    expect(top([], 'tag')).toMatchObject({ kind: 'action', action: { id: 'go:tag' } });
    expect(top([], 'new post')).toMatchObject({ kind: 'action', action: { id: 'new:post' } });
  });

  it('goes to the entry on a tie', () => {
    expect(top([entry('Media', 'media')], 'media')).toMatchObject({ kind: 'entry' });
  });

  it('is none for an empty query, and never a disabled action', () => {
    expect(top([entry('Tires', 'tires')], '  ')).toBeNull();
    const off = build({ screenActions: [duplicate({ disabled: true, note: 'Save first' })] });
    expect(top([], 'duplicate', off)).toBeNull();
  });
});
