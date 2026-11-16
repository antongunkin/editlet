import { describe, expect, it } from 'vitest';

import { branchFromRoute, defaultBranchName, normalizeBranchInput, routeFromBranch } from './branchName';

const P = 'editlet/';

describe('branch names', () => {
  it('maps route values to branches and back', () => {
    expect(branchFromRoute('spring', P)).toBe('editlet/spring');
    expect(branchFromRoute('editlet/spring', P)).toBe('editlet/spring');
    expect(routeFromBranch('editlet/spring', P)).toBe('spring');
    expect(branchFromRoute(routeFromBranch('editlet/a/b', P), P)).toBe('editlet/a/b');
    expect(routeFromBranch(branchFromRoute('a/b', P), P)).toBe('a/b');
  });

  it('normalizes typed input to the part after editlet/', () => {
    expect(normalizeBranchInput(' editlet/Spring Sale ', P)).toBe('spring-sale');
    expect(normalizeBranchInput('New_Idea', P)).toBe('new-idea');
    expect(normalizeBranchInput('a  b', P)).toBe('a-b');
    expect(normalizeBranchInput('', P)).toBe('');
  });

  it('builds a default name from the entry, made unique', () => {
    expect(defaultBranchName(P, 'post', 'hello-world', false, [])).toBe('editlet/post-hello-world');
    expect(defaultBranchName(P, 'post', 'hello-world', false, ['editlet/post-hello-world'])).toBe(
      'editlet/post-hello-world-2',
    );
    expect(
      defaultBranchName(P, 'post', 'hello-world', false, ['editlet/post-hello-world', 'editlet/post-hello-world-2']),
    ).toBe('editlet/post-hello-world-3');
    expect(defaultBranchName(P, 'homePage', 'index', true, [])).toBe('editlet/homepage');
    expect(defaultBranchName(P, 'post', 'Hello World!', false, new Set(['main']))).toBe('editlet/post-hello-world');
    expect(defaultBranchName('cms/', 'post', 'a', false, [])).toBe('cms/post-a');
    expect(routeFromBranch('cms/a', 'cms/')).toBe('a');
  });
});
