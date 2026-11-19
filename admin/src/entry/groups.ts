import type { FieldGroupFields } from '../../../core/schema';

/** One tab of the entry's field groups: its key, its name and whether its fields are changed or invalid. */
export interface GroupTab {
  key: string;
  label: string;
  mark?: 'changed' | 'invalid';
}

/** The group a row belongs to (`fieldGroups`); a key in no group (the body without a markdown field) is in the first. */
export function groupOf(groups: FieldGroupFields[], key: string): string {
  return (groups.find((g) => g.fields.includes(key)) ?? groups[0])?.key ?? '';
}

/** The tabs with their marks: red when a row of the group is invalid, amber when one is changed. */
export function groupTabs(
  groups: FieldGroupFields[],
  items: { key: string; error?: string[]; changed?: boolean }[],
): GroupTab[] {
  return groups.map((g) => {
    const own = items.filter((i) => groupOf(groups, i.key) === g.key);
    const mark = own.some((i) => (i.error?.length ?? 0) > 0)
      ? 'invalid'
      : own.some((i) => i.changed)
        ? 'changed'
        : undefined;
    return { key: g.key, label: g.label, mark };
  });
}
