import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { cn, Field, FIELD_INPUT_CLASS } from '../ui';

const PICKER_FALLBACK = '#000000';
const HEX = /^#[0-9a-f]{6}$/i;

/** Native color picker plus a `#rrggbb` text input; the text is passed through as typed (validation reports it). */
export function ColorField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <div className="editlet-ff-color__row">
        <input
          type="color"
          className="editlet-ff-color__picker"
          value={HEX.test(value) ? value.toLowerCase() : PICKER_FALLBACK}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          onBlur={onBlur}
          aria-invalid={invalid(error)}
          aria-describedby={describedBy(name, field, error)}
          aria-required={field.required || undefined}
          aria-label={`${field.label} color picker`}
        />
        <div className="editlet-ff-color__input-wrap">
          <input
            id={name}
            type="text"
            name={name}
            className={cn(FIELD_INPUT_CLASS, 'editlet-ff-color__hex-input')}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder="#aabbcc"
            spellCheck={false}
            aria-invalid={invalid(error)}
            aria-describedby={describedBy(name, field, error)}
            aria-label={field.label}
            aria-required={field.required || undefined}
          />
        </div>
      </div>
    </Field>
  );
}
