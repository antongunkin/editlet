import type { Collection } from '../../../core/schema';

// ⋯ → Duplicate (docs/admin/entry-form.md#duplicate): the address and the frontmatter of a copy.

/**
 * The copy's address: `<slug>-copy`, then `-copy-2`, `-copy-3`…, the first one no entry of the collection has. A copy of
 * a copy stays in the family (`tires-copy` → `tires-copy-2`).
 */
export function copySlug(slug: string, taken: ReadonlySet<string>): string {
  const base = slug.replace(/-copy(?:-\d+)?$/, '') || slug;
  for (let n = 1; ; n++) {
    const next = n === 1 ? `${base}-copy` : `${base}-copy-${n}`;
    if (!taken.has(next)) return next;
  }
}

/** The field that names an entry: `titleField`, else the first `string` or `text` field with a text value. */
export function titleKey(collection: Collection, data: Record<string, unknown>): string | undefined {
  if (collection.titleField !== undefined) return collection.titleField;
  for (const [key, field] of Object.entries(collection.fields)) {
    if (field.type !== 'string' && field.type !== 'text') continue;
    const value = data[key];
    if (typeof value === 'string' && value.trim() !== '') return key;
  }
  return undefined;
}

/**
 * The copy's frontmatter: every value as it is, the title with ` (copy)` after it, and `draft: true`: a copy is a new
 * entry, and every new entry starts as a draft (`initialData`), so a copy of a published entry does not go live by
 * itself.
 */
export function copyData(collection: Collection, data: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...structuredClone(data), draft: true };
  const key = titleKey(collection, data);
  const title = key === undefined ? undefined : data[key];
  if (key !== undefined && typeof title === 'string' && title.trim() !== '') copy[key] = `${title.trim()} (copy)`;
  return copy;
}
