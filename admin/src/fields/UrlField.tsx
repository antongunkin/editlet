import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, Input } from '../ui';

export function UrlField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <Input
        id={name}
        type="text"
        inputMode="url"
        autoComplete="url"
        name={name}
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
