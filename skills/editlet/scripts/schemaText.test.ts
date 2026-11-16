import { describe, expect, it } from 'vitest';

import { removeInSchemaText, renameInSchemaText } from './schemaText';

/** The expected object after renaming `from` → `to` in the collection's fields (and titleField / slugFrom). */
function renamed(text: string, collection: string, from: string, to: string): unknown {
  const raw = JSON.parse(text);
  const col = raw.collections[collection];
  col.fields = Object.fromEntries(Object.entries(col.fields).map(([k, v]) => [k === from ? to : k, v]));
  if (col.titleField === from) col.titleField = to;
  if (col.slugFrom === from) col.slugFrom = to;
  return raw;
}

function removed(text: string, collection: string, field: string): unknown {
  const raw = JSON.parse(text);
  const col = raw.collections[collection];
  delete col.fields[field];
  if (col.titleField === field) delete col.titleField;
  if (col.slugFrom === field) delete col.slugFrom;
  return raw;
}

const SCHEMA = `{
  "contentDir": "cms/content",
  "collections": {
    "post": {
      "label": "title",
      "titleField": "title",
      "fields": {
        "title": { "type": "string", "label": "Title", "options": ["title", 1, true, null, { "a": [] }] },
        "body": { "type": "markdown", "label": "Body" }
      }
    },
    "page": {
      "fields": { "title": { "type": "string", "label": "Title" } }
    }
  }
}
`;

describe('renameInSchemaText', () => {
  it('renames only the tokens that make the expected object, inside the collection', () => {
    const out = renameInSchemaText(SCHEMA, 'post', 'title', 'headline', renamed(SCHEMA, 'post', 'title', 'headline'));
    expect(out).toBe(
      SCHEMA.replace('"titleField": "title"', '"titleField": "headline"').replace(
        '"title": { "type": "string", "label": "Title", "options"',
        '"headline": { "type": "string", "label": "Title", "options"',
      ),
    );
    // The label "title" of post, the option "title" and the page's own field stay.
    expect(out).toContain('"label": "title"');
    expect(out).toContain('"options": ["title"');
    expect(out).toContain('"page": {\n      "fields": { "title"');
  });

  it('decodes escaped keys and writes the new key as JSON', () => {
    const text = '{"collections":{"c":{"fields":{"a\\u0062":{"type":"string","label":"x"}}}}}';
    const expected = renamed(text, 'c', 'ab', 'q"uote');
    expect(renameInSchemaText(text, 'c', 'ab', 'q"uote', expected)).toBe(
      '{"collections":{"c":{"fields":{"q\\"uote":{"type":"string","label":"x"}}}}}',
    );
  });

  it('searches the whole text when the collection is not found', () => {
    const text = '{"collections":{"c":{"fields":{"a":1}}}}';
    const expected = { collections: { c: { fields: { b: 1 } } } };
    expect(renameInSchemaText(text, 'missing', 'a', 'b', expected)).toBe('{"collections":{"c":{"fields":{"b":1}}}}');
  });

  it('gives up on no occurrence, too many occurrences, malformed text or an unreachable result', () => {
    const text = '{"collections":{"c":{"fields":{"a":1}}}}';
    expect(renameInSchemaText(text, 'c', 'zzz', 'b', {})).toBeNull();
    const many = `{"collections":{"c":{"fields":{"a":[${Array(13).fill('"a"').join(',')}]}}}}`;
    expect(renameInSchemaText(many, 'c', 'a', 'b', {})).toBeNull();
    expect(renameInSchemaText('{"collections": {"c": ', 'c', 'a', 'b', {})).toBeNull();
    expect(renameInSchemaText(text, 'c', 'a', 'b', { other: true })).toBeNull();
  });

  it.each([
    ['unterminated string', '{"collections": {"c'],
    ['a key that is not a string', '{"collections": {c: 1}}'],
    ['a missing colon', '{"collections" 1}'],
    ['a missing comma in an object', '{"collections": {} "x": 1}'],
    ['a missing comma in an array', '{"collections": {"c": [1 2]}}'],
    ['trailing content', '{"collections": {}} x'],
    ['an unexpected character', '{"collections": ,}'],
  ])('returns null for %s', (_, text) => {
    expect(renameInSchemaText(text, 'c', 'collections', 'x', {})).toBeNull();
  });
});

describe('removeInSchemaText', () => {
  it('removes a middle field line, the last field and titleField when it names the field', () => {
    const out = removeInSchemaText(SCHEMA, 'post', 'title', removed(SCHEMA, 'post', 'title'));
    expect(out).toBe(
      SCHEMA.replace('      "titleField": "title",\n', '').replace(
        '        "title": { "type": "string", "label": "Title", "options": ["title", 1, true, null, { "a": [] }] },\n',
        '',
      ),
    );
    const last = removeInSchemaText(SCHEMA, 'post', 'body', removed(SCHEMA, 'post', 'body'));
    expect(last).toContain('"options": ["title", 1, true, null, { "a": [] }] }\n      }');
  });

  it('keeps titleField / slugFrom that name another field', () => {
    const text = '{"collections":{"c":{"titleField":"b","slugFrom":"b","fields":{"a":1,"b":2}}}}';
    expect(removeInSchemaText(text, 'c', 'a', removed(text, 'c', 'a'))).toBe(
      '{"collections":{"c":{"titleField":"b","slugFrom":"b","fields":{"b":2}}}}',
    );
  });

  it('removes inline members: first, last and the only one', () => {
    const text = '{"collections":{"c":{"fields":{ "a": 1, "b": 2, "c": 3 }, "slugFrom": "c"}}}';
    expect(removeInSchemaText(text, 'c', 'a', removed(text, 'c', 'a'))).toBe(
      '{"collections":{"c":{"fields":{ "b": 2, "c": 3 }, "slugFrom": "c"}}}',
    );
    expect(removeInSchemaText(text, 'c', 'c', removed(text, 'c', 'c'))).toBe(
      '{"collections":{"c":{"fields":{ "a": 1, "b": 2 }}}}',
    );
    const one = '{"collections":{"c":{"fields":{"a":1}}}}';
    expect(removeInSchemaText(one, 'c', 'a', removed(one, 'c', 'a'))).toBe('{"collections":{"c":{"fields":{}}}}');
  });

  it('removes the only field when it stands on its own line', () => {
    const text = '{"collections":{"c":{"fields":{\n  "a": 1\n}}}}';
    expect(removeInSchemaText(text, 'c', 'a', removed(text, 'c', 'a'))).toBe('{"collections":{"c":{"fields":{\n}}}}');
  });

  it('returns null for an unknown field, an unknown collection, malformed text or an unexpected result', () => {
    expect(removeInSchemaText(SCHEMA, 'post', 'nope', {})).toBeNull();
    expect(removeInSchemaText(SCHEMA, 'nope', 'title', {})).toBeNull();
    expect(removeInSchemaText('{"collections": {"post": ', 'post', 'title', {})).toBeNull();
    expect(removeInSchemaText(SCHEMA, 'post', 'body', { different: true })).toBeNull();
  });
});
