import type { Field } from '../../../core/schema';
import { fieldDescribedBy } from '../ui/Field';

/** Joined error text for `Field`, or `undefined` when there are no messages. */
export function errorText(error: string[] | undefined): string | undefined {
  return error && error.length > 0 ? error.join('; ') : undefined;
}

/** `aria-invalid` value: `true` when there are messages, else omitted. */
export function invalid(error: string[] | undefined): true | undefined {
  return error && error.length > 0 ? true : undefined;
}

/** Common `Field` wrapper props for a widget; `name` is the base of the hint and error ids. */
export function fieldProps(field: Field, error: string[] | undefined, name: string) {
  return {
    label: field.label,
    hint: field.hint,
    required: field.required,
    error: errorText(error),
    describedById: name,
  };
}

/** `aria-describedby` for a widget's control: its field's hint and error, read with the control. */
export function describedBy(name: string, field: Field, error: string[] | undefined): string | undefined {
  return fieldDescribedBy(name, field.hint, errorText(error));
}

export const asString = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);

export const asStringList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

/**
 * Splits the messages of a container (`issuesByField` gives `title: Required`, `2.title: Required`) by their first
 * path segment: `{ title: ['Required'], '2': ['title: Required'], '': [own messages] }`.
 */
export function splitErrors(error: string[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const message of error ?? []) {
    const m = /^([A-Za-z0-9]+)(?:\.([^\s:]+))?: ([^]*)$/.exec(message);
    const key = m ? m[1]! : '';
    const text = !m ? message : m[2] ? `${m[2]}: ${m[3]}` : m[3]!;
    (out[key] ??= []).push(text);
  }
  return out;
}
