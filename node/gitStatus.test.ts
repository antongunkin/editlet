import { describe, expect, it } from 'vitest';

import { parsePorcelainZ, porcelainEntries } from './gitStatus';

const z = (...fields: string[]) => fields.map((f) => `${f}\0`).join('');

describe('porcelainEntries', () => {
  it('reads one entry per path, and the old path after a rename or copy', () => {
    const out = z(' M a.md', 'R  b.md', 'old b.md', '?? c d.md', 'C  e.md', 'src.md');
    expect(porcelainEntries(out)).toEqual([
      { xy: ' M', path: 'a.md' },
      { xy: 'R ', path: 'b.md', from: 'old b.md' },
      { xy: '??', path: 'c d.md' },
      { xy: 'C ', path: 'e.md', from: 'src.md' },
    ]);
  });

  it('is empty for no output', () => {
    expect(porcelainEntries('')).toEqual([]);
  });
});

describe('parsePorcelainZ', () => {
  it('maps both status columns to added, modified and removed', () => {
    const out = z(
      ' M m.md',
      'M  staged.md',
      'MM both.md',
      ' T type.md',
      '?? new.md',
      'A  staged-new.md',
      'AM staged-new-edited.md',
      'AD gone-again.md',
      ' D deleted.md',
      'D  staged-deleted.md',
      'R  to.md',
      'from.md',
      'C  copy.md',
      'orig.md',
      'UU conflict.md',
      'AU au.md',
      'UD ud.md',
      'AA aa.md',
      'DD dd.md',
    );
    expect(parsePorcelainZ(out, '')).toEqual([
      { path: 'm.md', status: 'modified' },
      { path: 'staged.md', status: 'modified' },
      { path: 'both.md', status: 'modified' },
      { path: 'type.md', status: 'modified' },
      { path: 'new.md', status: 'added' },
      { path: 'staged-new.md', status: 'added' },
      { path: 'staged-new-edited.md', status: 'added' },
      { path: 'deleted.md', status: 'removed' },
      { path: 'staged-deleted.md', status: 'removed' },
      { path: 'to.md', status: 'added' },
      { path: 'from.md', status: 'removed' },
      { path: 'copy.md', status: 'added' },
      { path: 'conflict.md', status: 'modified' },
      { path: 'au.md', status: 'modified' },
      { path: 'ud.md', status: 'modified' },
      { path: 'aa.md', status: 'added' },
      { path: 'dd.md', status: 'removed' },
    ]);
  });

  it('keeps only the removal of a rename or copy whose new path was deleted again', () => {
    expect(parsePorcelainZ(z('RD new.md', 'old.md', 'CD copy.md', 'src.md'), '')).toEqual([
      { path: 'old.md', status: 'removed' },
    ]);
  });

  it('lists a path once: removed from the index and untracked on disk is modified', () => {
    expect(parsePorcelainZ(z('D  f.md', '?? f.md'), '')).toEqual([{ path: 'f.md', status: 'modified' }]);
  });

  it('strips the project prefix and drops paths outside it', () => {
    const out = z(' M site/cms/a.md', '?? other/b.md', 'R  site/c.md', 'other/c.md');
    expect(parsePorcelainZ(out, 'site/')).toEqual([
      { path: 'cms/a.md', status: 'modified' },
      { path: 'c.md', status: 'added' },
    ]);
  });

  it('keeps spaces, quotes and arrows in paths as they are', () => {
    const out = z(' M cms/a "b" c.md', 'R  cms/x -> y.md', 'cms/x.md');
    expect(parsePorcelainZ(out, '')).toEqual([
      { path: 'cms/a "b" c.md', status: 'modified' },
      { path: 'cms/x -> y.md', status: 'added' },
      { path: 'cms/x.md', status: 'removed' },
    ]);
  });
});
