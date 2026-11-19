import { describe, expect, it } from 'vitest';

import { EditletError } from './issues';
import { collectionNames, fieldGroups, loadSchema, markdownFieldKey } from './schema';

function fixture(): any {
  return {
    contentDir: 'cms/content',
    git: { baseBranch: 'main' },
    collections: {
      post: {
        label: 'Post',
        titleField: 'title',
        slugFrom: 'title',
        fields: {
          title: { type: 'string', label: 'Title', required: true },
          body: { type: 'markdown', label: 'Body' },
          tags: { type: 'string', label: 'Tags', list: true },
          author: { type: 'reference', label: 'Author', collections: ['author'] },
        },
      },
      author: { label: 'Author', fields: { name: { type: 'string', label: 'Name' } } },
      homePage: { label: 'Home', singleton: true, fields: { headline: { type: 'string', label: 'Headline' } } },
    },
  };
}

const withGit = (git: object) => ({ ...fixture(), git: { baseBranch: 'main', ...git } });

function issuesOf(input: unknown) {
  try {
    loadSchema(input);
  } catch (e) {
    expect(e).toBeInstanceOf(EditletError);
    return (e as EditletError).issues;
  }
  throw new Error('expected loadSchema to throw');
}

describe('loadSchema', () => {
  describe('git', () => {
    it('accepts the style keys', () => {
      const git = {
        branchPrefix: 'site/edits/',
        commitMessage: 'content({collection}): {action} {slug}',
        pullRequest: { title: 'Content: {name} by {login}', labels: [' editlet ', 'content'], draft: true },
      };
      expect(loadSchema(withGit(git)).git).toEqual({
        baseBranch: 'main',
        ...git,
        pullRequest: { ...git.pullRequest, labels: ['editlet', 'content'] },
      });
    });

    it('keeps every style key optional', () => {
      expect(loadSchema(fixture()).git).toEqual({ baseBranch: 'main' });
    });

    it.each(['editlet', '/editlet/', 'a//b/', 'a..b/', 'x.lock/', '-x/', 'a b/', ''])(
      'rejects branchPrefix %j',
      (branchPrefix) => {
        expect(issuesOf(withGit({ branchPrefix })).map((i) => i.path)).toContain('git.branchPrefix');
      },
    );

    it('rejects a branchPrefix that clashes with the base branch', () => {
      expect(issuesOf(withGit({ branchPrefix: 'main/' }))[0]).toMatchObject({ path: 'git.branchPrefix' });
      expect(issuesOf(withGit({ branchPrefix: 'main/edits/' }))[0]).toMatchObject({ path: 'git.branchPrefix' });
      const nested = { ...fixture(), git: { baseBranch: 'editlet/live', branchPrefix: 'editlet/' } };
      expect(issuesOf(nested)[0]).toMatchObject({ path: 'git.branchPrefix' });
      expect(loadSchema(withGit({ branchPrefix: 'mainline/' })).git.branchPrefix).toBe('mainline/');
    });

    it('rejects unknown placeholders and line breaks', () => {
      expect(issuesOf(withGit({ commitMessage: '{verb} {slug}' }))[0]).toMatchObject({
        path: 'git.commitMessage',
        message: expect.stringContaining('unknown placeholder "{verb}"'),
      });
      expect(issuesOf(withGit({ commitMessage: 'a\nb' }))[0]?.path).toBe('git.commitMessage');
      expect(issuesOf(withGit({ pullRequest: { title: '{slug}' } }))[0]?.path).toBe('git.pullRequest.title');
      expect(issuesOf(withGit({ commitMessage: '  ' }))[0]?.path).toBe('git.commitMessage');
    });

    it('rejects bad labels and unknown keys', () => {
      expect(issuesOf(withGit({ pullRequest: { labels: ['a,b'] } }))[0]?.path).toBe('git.pullRequest.labels.0');
      expect(issuesOf(withGit({ pullRequest: { labels: Array(11).fill('x') } }))[0]?.path).toBe(
        'git.pullRequest.labels',
      );
      expect(issuesOf(withGit({ pullRequest: { reviewers: [] } }))[0]?.message).toBe('unknown key "reviewers"');
      expect(issuesOf(withGit({ prefix: 'x/' }))[0]?.message).toBe('unknown key "prefix"');
    });
  });

  it('loads a valid schema', () => {
    expect(loadSchema(fixture()).collections.post.fields.title.type).toBe('string');
  });

  it('rejects unknown field type', () => {
    const fx = fixture();
    fx.collections.post.fields.x = { type: 'slug', label: 'X' };
    expect(issuesOf(fx)[0].path).toBe('collections.post.fields.x.type');
  });

  it('rejects two markdown fields', () => {
    const fx = fixture();
    fx.collections.post.fields.extra = { type: 'markdown', label: 'Extra' };
    const issue = issuesOf(fx).find((i) => i.path === 'collections.post.fields');
    expect(issue?.message).toContain('one markdown field');
  });

  it('rejects titleField / slugFrom not in fields', () => {
    const fx = fixture();
    fx.collections.post.titleField = 'nope';
    fx.collections.post.slugFrom = 'nope';
    const paths = issuesOf(fx).map((i) => i.path);
    expect(paths).toContain('collections.post.titleField');
    expect(paths).toContain('collections.post.slugFrom');
  });

  it('rejects reference to unknown collection', () => {
    const fx = fixture();
    fx.collections.post.fields.author.collections = ['ghost'];
    expect(issuesOf(fx).map((i) => i.path)).toContain('collections.post.fields.author.collections.0');
  });

  it('rejects collection key that is not a valid slug', () => {
    const fx = fixture();
    fx.collections['Blog Post'] = { label: 'B', fields: {} };
    expect(issuesOf(fx).length).toBeGreaterThan(0);
  });

  it('rejects bad contentDir and empty select options', () => {
    const fx = fixture();
    fx.contentDir = '../x';
    fx.collections.post.fields.s = { type: 'select', label: 'S', options: [] };
    const paths = issuesOf(fx).map((i) => i.path);
    expect(paths).toContain('contentDir');
    expect(paths).toContain('collections.post.fields.s.options');
  });
});

describe('loadSchema hardening', () => {
  it('rejects prototype names as titleField, slugFrom and reference targets', () => {
    const fx = fixture();
    fx.collections.post.titleField = 'toString';
    fx.collections.post.slugFrom = 'toString';
    fx.collections.post.fields.author.collections = ['constructor'];
    const paths = issuesOf(fx).map((i) => i.path);
    expect(paths).toContain('collections.post.titleField');
    expect(paths).toContain('collections.post.slugFrom');
    expect(paths).toContain('collections.post.fields.author.collections.0');
  });

  it.each(['.', './x', 'a//b', 'cms/content/', '/abs', 'a\\b', '', 'a/../b'])('rejects contentDir %j', (dir) => {
    const fx = fixture();
    fx.contentDir = dir;
    expect(issuesOf(fx).map((i) => i.path)).toContain('contentDir');
  });
});

describe('loadSchema final rules', () => {
  it('reserves the field key draft', () => {
    const fx = fixture();
    fx.collections.post.fields.draft = { type: 'boolean', label: 'Draft' };
    const issue = issuesOf(fx).find((i) => i.path === 'collections.post.fields.draft');
    expect(issue?.message).toContain('reserved');
  });

  it('rejects collection keys that differ only in case', () => {
    const fx = fixture();
    fx.collections.Post = { label: 'P', fields: {} };
    const issue = issuesOf(fx).find((i) => i.path === 'collections.post' || i.path === 'collections.Post');
    expect(issue?.message).toContain('case');
  });

  it('accepts an optional root $schema string', () => {
    const fx = fixture();
    fx.$schema = './node_modules/editlet/schema.json';
    expect(loadSchema(fx).$schema).toBe('./node_modules/editlet/schema.json');
    fx.$schema = 1;
    expect(issuesOf(fx).map((i) => i.path)).toContain('$schema');
  });

  const options = [
    { label: 'A', value: 'a' },
    { label: 'B', value: 'b' },
  ];
  it.each([
    [{ type: 'select', label: 'S', options, default: 'z' }, 'default'],
    [{ type: 'select', label: 'S', options, default: ['a'] }, 'default'],
    [{ type: 'select', label: 'S', options, multiple: true, default: 'a' }, 'default'],
    [{ type: 'select', label: 'S', options, multiple: true, default: ['a', 'z'] }, 'default.1'],
    [{ type: 'number', label: 'N', min: 1, max: 5, default: 9 }, 'default'],
    [{ type: 'number', label: 'N', min: 1, default: 0 }, 'default'],
    [{ type: 'number', label: 'N', integer: true, default: 1.5 }, 'default'],
    [{ type: 'string', label: 'S', default: ['a'] }, 'default'],
    [{ type: 'string', label: 'S', list: true, default: 'a' }, 'default'],
    [{ type: 'color', label: 'C', default: 'red' }, 'default'],
  ])('rejects a default that fails its own field rules: %j', (field, path) => {
    const fx = fixture();
    fx.collections.post.fields.f = field;
    expect(issuesOf(fx).map((i) => i.path)).toContain(`collections.post.fields.f.${path}`);
  });

  it.each([
    { type: 'select', label: 'S', options, default: 'a' },
    { type: 'select', label: 'S', options, multiple: true, default: ['a', 'b'] },
    { type: 'number', label: 'N', min: 1, max: 5, integer: true, default: 3 },
    { type: 'string', label: 'S', default: 'x' },
    { type: 'string', label: 'S', list: true, default: ['x'] },
    { type: 'boolean', label: 'B', default: false },
    { type: 'text', label: 'T', default: '' },
  ])('accepts a default that passes its own field rules: %j', (field) => {
    const fx = fixture();
    fx.collections.post.fields.f = field;
    expect(() => loadSchema(fx)).not.toThrow();
  });
});

describe('markdownFieldKey', () => {
  it('returns body', () => {
    expect(markdownFieldKey(loadSchema(fixture()).collections.post)).toBe('body');
  });
  it('returns undefined when none', () => {
    expect(markdownFieldKey(loadSchema(fixture()).collections.author)).toBeUndefined();
  });
});

describe('field groups', () => {
  const grouped = () => {
    const fx = fixture();
    fx.collections.post.groups = { content: { label: 'Content' }, media: { label: 'Media' }, seo: { label: 'SEO' } };
    fx.collections.post.fields.cover = { type: 'image', label: 'Cover', group: 'media' };
    fx.collections.post.fields.tags.group = 'seo';
    return fx;
  };

  it('accepts groups and a group on a top-level field', () => {
    expect(() => loadSchema(grouped())).not.toThrow();
  });

  it('rejects a group the collection does not declare', () => {
    const fx = grouped();
    fx.collections.post.fields.title.group = 'meta';
    expect(issuesOf(fx)).toContainEqual({
      path: 'collections.post.fields.title.group',
      message: 'unknown group "meta" (add it to post.groups)',
    });
    const none = fixture();
    none.collections.post.fields.title.group = 'content';
    expect(issuesOf(none).map((i) => i.path)).toEqual(['collections.post.fields.title.group']);
  });

  it('rejects a group on a nested field', () => {
    const fx = grouped();
    fx.collections.post.fields.seo = {
      type: 'object',
      label: 'SEO',
      fields: { title: { type: 'string', label: 'Title', group: 'seo' } },
    };
    expect(issuesOf(fx)).toContainEqual({
      path: 'collections.post.fields.seo.fields.title.group',
      message: 'group is only for top-level fields',
    });
  });

  it('rejects a bad group key and an empty label', () => {
    const fx = grouped();
    fx.collections.post.groups['bad-key'] = { label: 'Bad' };
    fx.collections.post.groups.media.label = '';
    const paths = issuesOf(fx).map((i) => i.path);
    expect(paths).toContain('collections.post.groups.bad-key');
    expect(paths).toContain('collections.post.groups.media.label');
  });

  it('rejects an unknown key in a group', () => {
    const fx = grouped();
    fx.collections.post.groups.media.icon = 'image';
    expect(issuesOf(fx)).toContainEqual({ path: 'collections.post.groups.media.icon', message: 'unknown key "icon"' });
  });

  it('puts fields without a group into the first one, in schema order, and drops empty groups', () => {
    const fx = grouped();
    fx.collections.post.groups.empty = { label: 'Empty' };
    expect(fieldGroups(loadSchema(fx).collections.post)).toEqual([
      { key: 'content', label: 'Content', fields: ['title', 'body', 'author'] },
      { key: 'media', label: 'Media', fields: ['cover'] },
      { key: 'seo', label: 'SEO', fields: ['tags'] },
    ]);
  });

  it('uses own keys only: a prototype name is no group, but may be a group key', () => {
    const fx = grouped();
    fx.collections.post.fields.title.group = 'toString';
    expect(issuesOf(fx).map((i) => i.path)).toEqual(['collections.post.fields.title.group']);
    const own = grouped();
    own.collections.post.groups = { constructor: { label: 'Main' }, media: { label: 'Media' }, seo: { label: 'SEO' } };
    expect(fieldGroups(loadSchema(own).collections.post).map((g) => g.key)).toEqual(['constructor', 'media', 'seo']);
  });

  it('is one group of every field without groups', () => {
    expect(fieldGroups(loadSchema(fixture()).collections.post)).toEqual([
      { key: '', label: '', fields: ['title', 'body', 'tags', 'author'] },
    ]);
  });
});

describe('pluralLabel and url', () => {
  const withPost = (keys: object) => {
    const fx = fixture();
    Object.assign(fx.collections.post, keys);
    return fx;
  };
  const withHome = (keys: object) => {
    const fx = fixture();
    Object.assign(fx.collections.homePage, keys);
    return fx;
  };

  it('loads a schema without the keys unchanged', () => {
    const post = loadSchema(fixture()).collections.post;
    expect(post.pluralLabel).toBeUndefined();
    expect(post.url).toBeUndefined();
  });

  it('keeps both keys as written', () => {
    const schema = loadSchema(withPost({ pluralLabel: ' Posts ', url: '/posts/{slug}/' }));
    expect(schema.collections.post).toMatchObject({ pluralLabel: ' Posts ', url: '/posts/{slug}/' });
    expect(loadSchema(withHome({ url: '/' })).collections.homePage.url).toBe('/');
  });

  it('rejects a blank or too long pluralLabel, and one on a singleton', () => {
    expect(issuesOf(withPost({ pluralLabel: '  ' }))).toEqual([
      { path: 'collections.post.pluralLabel', message: 'pluralLabel must not be empty' },
    ]);
    expect(issuesOf(withPost({ pluralLabel: '' }))[0]).toMatchObject({ path: 'collections.post.pluralLabel' });
    expect(issuesOf(withPost({ pluralLabel: 'x'.repeat(101) }))[0]).toMatchObject({
      path: 'collections.post.pluralLabel',
      message: expect.stringContaining('Too big'),
    });
    expect(issuesOf(withHome({ pluralLabel: 'Homes' }))).toEqual([
      { path: 'collections.homePage.pluralLabel', message: 'pluralLabel is only for collections with many entries' },
    ]);
  });

  it('rejects a bad url with the rule at the collection path', () => {
    expect(issuesOf(withPost({ url: 'posts/{slug}' }))).toEqual([
      { path: 'collections.post.url', message: `url must be a path from the site's root, for example "/posts/{slug}"` },
    ]);
    expect(issuesOf(withPost({ url: '/posts/{title}' }))[0]).toEqual({
      path: 'collections.post.url',
      message: 'unknown placeholder "{title}" (use {slug})',
    });
    expect(issuesOf(withHome({ url: '/{slug}' }))[0]).toEqual({
      path: 'collections.homePage.url',
      message: 'a singleton has one page: url cannot use {slug}',
    });
    expect(issuesOf(withPost({ url: 3 }))[0]?.path).toBe('collections.post.url');
  });
});

describe('collectionNames', () => {
  it('gives the plural for many and the label for one, the label for both without a plural', () => {
    const fx = fixture();
    fx.collections.post.pluralLabel = 'Posts';
    const schema = loadSchema(fx);
    expect(collectionNames(schema.collections.post)).toEqual({ one: 'Post', many: 'Posts' });
    expect(collectionNames(schema.collections.author)).toEqual({ one: 'Author', many: 'Author' });
  });
});
