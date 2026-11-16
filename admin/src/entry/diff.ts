import { stringify } from 'yaml';

import { deepEqual, type DataBody } from './values';

import { markdownFieldKey, type Collection, type FieldType } from '../../../core/schema';

export interface FieldDiffRow {
  key: string;
  label: string;
  /** The field type; `boolean` for the draft flag, `unknown` for keys outside the schema. */
  type: FieldType | 'unknown';
  before: string;
  after: string;
}

/** Display text: `''` for absent, scalars via `String`, objects and arrays as YAML. */
export function valueText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return stringify(v, { lineWidth: 0 }).replace(/\n$/, '');
  return String(v);
}

/** Changed fields only, in schema order, then keys outside the schema (sorted), then `draft`. */
export function entryDiff(collection: Collection, before: DataBody | null, after: DataBody): FieldDiffRow[] {
  const prev = before ?? { data: {}, body: '' };
  const rows: FieldDiffRow[] = [];
  const add = (key: string, label: string, type: FieldDiffRow['type'], a: unknown, b: unknown) => {
    if (!deepEqual(a, b)) rows.push({ key, label, type, before: valueText(a), after: valueText(b) });
  };

  for (const [key, field] of Object.entries(collection.fields)) {
    if (field.type === 'markdown') add(key, field.label, 'markdown', prev.body, after.body);
    else add(key, field.label, field.type, prev.data[key], after.data[key]);
  }
  if (markdownFieldKey(collection) === undefined) add('__body', 'Body', 'markdown', prev.body, after.body);

  const extra = new Set(
    [...Object.keys(prev.data), ...Object.keys(after.data)].filter(
      (k) => k !== 'draft' && !Object.hasOwn(collection.fields, k),
    ),
  );
  for (const key of [...extra].toSorted()) add(key, key, 'unknown', prev.data[key], after.data[key]);
  add('draft', 'Draft', 'boolean', prev.data.draft, after.data.draft);
  return rows;
}
