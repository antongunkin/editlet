import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectionPrompts,
  diffModel,
  globalPrompts,
  fieldRows,
  hasChanges,
  incoming,
  outgoing,
  referenceEdges,
} from './model';

import { loadSchema, type Field, type Schema } from '../../../core/schema';

const fixture = (): Schema =>
  loadSchema(JSON.parse(readFileSync(join(__dirname, '../../../node/__fixtures__/site/cms/schema.json'), 'utf8')));

const withField = (schema: Schema, collection: string, key: string, field: Field): Schema => ({
  ...schema,
  collections: {
    ...schema.collections,
    [collection]: {
      ...schema.collections[collection],
      fields: { ...schema.collections[collection].fields, [key]: field },
    },
  },
});

const single = (key: string, field: Field): Schema => ({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { c: { label: 'C', fields: { [key]: field } } },
});

const rowOf = (key: string, field: Field) => fieldRows(single(key, field).collections.c)[0];

describe('fieldRows', () => {
  it('lists fields in schema order with type, required, targets and badges', () => {
    const rows = fieldRows(fixture().collections.post);
    expect(rows.map((r) => r.key)).toEqual(['title', 'body', 'featuredImage', 'author']);
    expect(rows[0]).toMatchObject({ required: true, type: 'string' });
    expect(rows[1].badges).toEqual(['body']);
    expect(rows[3]).toMatchObject({ type: 'reference', targets: ['author'], many: false });
  });

  it('adds title and slug source badges in that order', () => {
    const schema = fixture();
    const post = { ...schema.collections.post, titleField: 'title', slugFrom: 'title' };
    expect(fieldRows(post)[0].badges).toEqual(['title', 'slugSource']);
  });

  it('labels list and multiple types', () => {
    expect(rowOf('a', { type: 'string', label: 'A', list: true }).type).toBe('string, list');
    const select: Field = { type: 'select', label: 'A', multiple: true, options: [{ label: 'x', value: 'x' }] };
    expect(rowOf('a', select).type).toBe('select, multiple');
  });

  it('says the group of a top-level field when the collection has groups', () => {
    const rows = fieldRows({
      label: 'Page',
      groups: { content: { label: 'Content' }, media: { label: 'Media' } },
      fields: {
        title: { type: 'string', label: 'Title' },
        seo: { type: 'object', label: 'SEO', group: 'media', fields: { t: { type: 'string', label: 'T' } } },
      },
    });
    expect(rows.map((r) => [r.key, r.details.filter((d) => d.startsWith('group'))])).toEqual([
      ['title', ['group: Content']],
      ['seo', ['group: Media']],
      ['seo.t', []],
    ]);
    expect(fieldRows({ label: 'P', fields: { t: { type: 'string', label: 'T' } } })[0]!.details).toEqual([]);
  });

  it('describes details per type', () => {
    const options = [
      { label: 'Draft', value: 'draft' },
      { label: 'x', value: 'x' },
    ];
    expect(rowOf('a', { type: 'select', label: 'A', options }).details).toEqual(['options: Draft (draft), x']);
    const number: Field = { type: 'number', label: 'A', min: 0, max: 10, step: 1, integer: true, default: 5 };
    expect(rowOf('a', number).details).toEqual(['min: 0', 'max: 10', 'step: 1', 'integer', 'default: 5']);
    expect(rowOf('a', { type: 'text', label: 'A', rows: 4 }).details).toEqual(['rows: 4']);
    expect(rowOf('a', { type: 'datetime', label: 'A', dateOnly: true, defaultNow: true }).details).toEqual([
      'date only',
      'default now',
    ]);
    const bool: Field = { type: 'boolean', label: 'A', labels: { true: 'Yes', false: 'No' }, default: false };
    expect(rowOf('a', bool).details).toEqual(['labels: Yes / No', 'default: false']);
    expect(rowOf('a', { type: 'string', label: 'A', default: 'hi' }).details).toEqual(['default: "hi"']);
    const ref: Field = { type: 'reference', label: 'A', collections: ['c'], multiple: true, min: 1, max: 3 };
    expect(rowOf('a', ref)).toMatchObject({ details: ['min: 1', 'max: 3'], many: true, targets: ['c'] });
  });
});

describe('referenceEdges', () => {
  it('finds the fixture edge and splits it by direction', () => {
    const edges = referenceEdges(fixture());
    expect(edges).toEqual([{ from: 'post', field: 'author', to: 'author', many: false }]);
    expect(incoming(edges, 'author')).toEqual(edges);
    expect(outgoing(edges, 'author')).toEqual([]);
  });

  it('counts a self reference once in each direction', () => {
    const schema = withField(fixture(), 'post', 'related', {
      type: 'reference',
      label: 'Related',
      collections: ['post'],
      multiple: true,
    });
    const edges = referenceEdges(schema);
    expect(outgoing(edges, 'post').filter((e) => e.field === 'related')).toHaveLength(1);
    expect(incoming(edges, 'post')).toEqual([{ from: 'post', field: 'related', to: 'post', many: true }]);
  });
});

describe('diffModel', () => {
  it('marks an added field new and its collection changed', () => {
    const next = withField(fixture(), 'post', 'subtitle', { type: 'string', label: 'Subtitle' });
    const changes = diffModel(fixture(), next);
    expect(changes.fields.get('post')?.get('subtitle')).toBe('new');
    expect(changes.collections.get('post')).toBe('changed');
    expect(hasChanges(changes)).toBe(true);
  });

  it('marks a changed field definition', () => {
    const next = withField(fixture(), 'post', 'title', { type: 'string', label: 'Headline', required: true });
    expect(diffModel(fixture(), next).fields.get('post')?.get('title')).toBe('changed');
  });

  it('lists removed fields and marks the collection changed', () => {
    const next = fixture();
    delete next.collections.post.fields.featuredImage;
    const changes = diffModel(fixture(), next);
    expect(changes.removed).toEqual(['post.featuredImage']);
    expect(changes.collections.get('post')).toBe('changed');
  });

  it('marks a new collection without field marks', () => {
    const next: Schema = {
      ...fixture(),
      collections: {
        ...fixture().collections,
        tag: { label: 'Tag', fields: { name: { type: 'string', label: 'Name' } } },
      },
    };
    const changes = diffModel(fixture(), next);
    expect(changes.collections.get('tag')).toBe('new');
    expect(changes.fields.has('tag')).toBe(false);
  });

  it('lists a removed collection', () => {
    const next = fixture();
    delete next.collections.homePage;
    expect(diffModel(fixture(), next).removed).toContain('homePage');
  });

  it('ignores field order and key order inside a definition', () => {
    const prev = fixture();
    const next: Schema = {
      ...prev,
      collections: {
        ...prev.collections,
        post: {
          ...prev.collections.post,
          fields: {
            author: prev.collections.post.fields.author,
            featuredImage: prev.collections.post.fields.featuredImage,
            body: prev.collections.post.fields.body,
            title: { required: true, label: 'Title', type: 'string' },
          },
        },
      },
    };
    expect(hasChanges(diffModel(prev, next))).toBe(false);
  });
});

describe('collectionPrompts', () => {
  it('fills the prompts with names from the collection', () => {
    const prompts = collectionPrompts(fixture(), 'cms/schema.json', 'post');
    expect(prompts.map((p) => p.id)).toEqual(['add-field', 'rename-field', 'remove-field', 'require-field']);
    expect(prompts.map((p) => p.text)).toEqual([
      'Add an optional string field "subtitle" (label "Subtitle") to the "post" collection in cms/schema.json.',
      'Rename field "title" in "post" to "headline" and update every entry. Dry-run first and show me the plan.',
      'Remove field "author" from "post". Dry-run first and tell me which entries lose data.',
      'Make "featuredImage" in "post" required. First check which entries would fail.',
    ]);
  });

  it('offers a reference to a collection it does not point to yet', () => {
    const prompts = collectionPrompts(fixture(), 'cms/schema.json', 'author');
    expect(prompts.find((p) => p.id === 'add-reference')).toMatchObject({
      title: 'Link to another collection',
      text: 'Add an optional reference field "post" to "author" that points to one "post" entry.',
    });
  });

  it('avoids taken names and names no product', () => {
    const schema = withField(fixture(), 'post', 'headline', { type: 'string', label: 'H' });
    const prompts = collectionPrompts(schema, 'cms/schema.json', 'post');
    expect(prompts[1]!.text).toContain('to "titleNew"');
    for (const p of prompts) expect(p.text).not.toMatch(/editlet/i);
  });
});

describe('globalPrompts', () => {
  it('adds a collection and reviews the schema; the fix prompt comes first when there are problems', () => {
    expect(globalPrompts(fixture(), 'cms/schema.json', { hasProblems: false }).map((p) => p.id)).toEqual([
      'add-collection',
      'review-schema',
    ]);
    const prompts = globalPrompts(fixture(), 'cms/schema.json', { hasProblems: true });
    expect(prompts[0]).toMatchObject({
      id: 'fix-problems',
      text: 'Run the content validation and fix the problems shown in the content model.',
    });
    expect(prompts[1]!.text).toBe(
      'Add a collection "tag" (label "Tag") with a required string field "name", and let "post" reference many tags.',
    );
  });

  it('does not throw on an empty schema and avoids taken names', () => {
    const empty: Schema = { contentDir: 'cms/content', git: { baseBranch: 'main' }, collections: {} };
    expect(globalPrompts(empty, 'cms/schema.json', { hasProblems: true })[1]!.text).toContain('"post"');
    const taken = withField(fixture(), 'post', 'x', { type: 'string', label: 'X' });
    taken.collections.tag = taken.collections.post;
    const next = globalPrompts(taken, 'cms/schema.json', { hasProblems: false });
    expect(next.find((p) => p.id === 'add-collection')!.text).toContain('many categories.');
  });
});
