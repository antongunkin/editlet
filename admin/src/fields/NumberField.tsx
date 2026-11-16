import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, FIELD_INPUT_CLASS } from '../ui';

/** Number as input text. A stored non-numeric value is shown in a text input so it stays visible and editable. */
export function NumberField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  const numeric = field.type === 'number' ? field : undefined;
  const step = numeric?.step ?? (numeric?.integer ? 1 : 'any');
  const isNumeric = value.trim() === '' || Number.isFinite(Number(value));
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <input
        id={name}
        className={FIELD_INPUT_CLASS}
        type={isNumeric ? 'number' : 'text'}
        name={name}
        value={value}
        min={numeric?.min}
        max={numeric?.max}
        step={step}
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
