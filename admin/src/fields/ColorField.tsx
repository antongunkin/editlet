import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, Input, Swatch, SwatchInput } from '../ui';

const PICKER_FALLBACK = '#000000';
const HEX = /^#[0-9a-f]{6}$/i;

/** Native color picker plus a `#rrggbb` text input; the text is passed through as typed (validation reports it). */
export function ColorField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <div className="flex flex-wrap items-center gap-3">
        <Swatch color={HEX.test(value) ? value.toLowerCase() : PICKER_FALLBACK}>
          <SwatchInput
            value={HEX.test(value) ? value.toLowerCase() : PICKER_FALLBACK}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            onBlur={onBlur}
            aria-invalid={invalid(error)}
            aria-describedby={describedBy(name, field, error)}
            aria-required={field.required || undefined}
            aria-label={`${field.label} color picker`}
          />
        </Swatch>
        <div className="flex-1">
          <Input
            id={name}
            type="text"
            name={name}
            className="font-mono"
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
