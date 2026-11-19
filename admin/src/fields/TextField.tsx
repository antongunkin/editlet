import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, Textarea } from '../ui';

const DEFAULT_ROWS = 4;

export function TextField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  const rows = field.type === 'text' && field.rows !== undefined ? field.rows : DEFAULT_ROWS;
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <Textarea
        id={name}
        name={name}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid(error)}
        aria-describedby={describedBy(name, field, error)}
        aria-label={field.label}
        aria-required={field.required || undefined}
      />
    </Field>
  );
}
