import { BLOCK_KEY, type Field } from '../../../core/schema';
import { formatStored } from '../fields/dates';

/** Names a referenced entry (`collection/slug`) for the row: its title, or the ref itself when it is not listed. */
export type EntryTitle = (ref: string) => string;

const asText = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The words of a Markdown text, and its images (`![alt](src)`), as the body's row says it: `1 240 words · 3 images`. */
export function markdownSummary(text: string): string {
  const images = text.match(/!\[[^\]]*\]\([^)]*\)/g)?.length ?? 0;
  const words = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~[\]()|-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  if (words === 0 && images === 0) return '';
  const parts = [count(words, 'word')];
  if (images > 0) parts.push(count(images, 'image'));
  return parts.join(' · ');
}

/** The first non-empty text of an item's own fields: names it in a row (`Quote: Quick and painless.`). */
export function itemTitle(fields: Record<string, Field>, item: Record<string, unknown>): string | undefined {
  for (const [key, f] of Object.entries(fields)) {
    const v = item[key];
    if ((f.type === 'string' || f.type === 'text') && typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

const asItem = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * What a field row shows under its label (FigCraft `FieldRow`): the value as one short line. An empty value gives `''`
 * (the row then says *Empty* or *Required*). Long text is cut by the row, not here.
 */
export function fieldSummary(field: Field, value: unknown, title: EntryTitle = (r) => r): string {
  switch (field.type) {
    case 'string':
      return field.list ? list(value).map(asText).filter(Boolean).join(', ') : asText(value);
    case 'text':
    case 'url':
    case 'color':
    case 'number':
      return asText(value).split('\n')[0]!.trim();
    case 'markdown':
      return markdownSummary(asText(value));
    case 'boolean': {
      if (typeof value !== 'boolean') return '';
      const labels = field.labels ?? { true: 'Yes', false: 'No' };
      return value ? labels.true : labels.false;
    }
    case 'select': {
      const label = (v: string) => field.options.find((o) => o.value === v)?.label ?? v;
      return field.multiple
        ? list(value).map(asText).filter(Boolean).map(label).join(', ')
        : asText(value) && label(asText(value));
    }
    case 'datetime':
      return asText(value) && formatStored(asText(value), field.dateOnly === true);
    case 'json': {
      const raw = asText(value).trim();
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) return count(parsed.length, 'item');
        if (parsed && typeof parsed === 'object') return count(Object.keys(parsed).length, 'key');
      } catch {
        // Not JSON yet: show what is typed.
      }
      return raw.split('\n')[0]!;
    }
    case 'image': {
      const v = typeof value === 'string' ? { src: value, alt: '' } : asItem(value);
      const src = asText(v.src);
      if (!src) return '';
      const name = src.slice(src.lastIndexOf('/') + 1);
      return asText(v.alt) ? `${name} · alt text set` : name;
    }
    case 'reference':
      return field.multiple
        ? list(value).map(asText).filter(Boolean).map(title).join(', ')
        : asText(value) && title(asText(value));
    case 'object': {
      if (field.list) return list(value).length ? count(list(value).length, 'item') : '';
      const item = asItem(value);
      return (
        itemTitle(field.fields, item) ??
        (Object.keys(item).length ? count(Object.keys(field.fields).length, 'field') : '')
      );
    }
    case 'blocks': {
      const blocks = list(value).map(asItem);
      if (blocks.length === 0) return '';
      const kinds = blocks.map((b) => field.blocks[asText(b[BLOCK_KEY])]?.label ?? asText(b[BLOCK_KEY]));
      return `${count(blocks.length, 'block')} · ${kinds.join(', ')}`;
    }
  }
}
