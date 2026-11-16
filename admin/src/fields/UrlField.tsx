import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, FIELD_INPUT_CLASS } from '../ui';

export function UrlField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <input
        id={name}
        className={FIELD_INPUT_CLASS}
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
