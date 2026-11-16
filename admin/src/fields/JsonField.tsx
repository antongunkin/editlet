import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { cn, Field, FIELD_TEXTAREA_CLASS } from '../ui';

function syntaxStatus(text: string): 'empty' | 'valid' | 'invalid' {
  const t = text.trim();
  if (t === '') return 'empty';
  try {
    JSON.parse(t);
    return 'valid';
  } catch {
    return 'invalid';
  }
}

/** JSON text in a monospace textarea; the value stays text (parsed by `formToEntry`). */
export function JsonField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  const status = syntaxStatus(value);
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <textarea
        id={name}
        className={cn(FIELD_TEXTAREA_CLASS, 'editlet-ff-json__textarea', invalid(error) && 'editlet-textarea--error')}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        spellCheck={false}
        aria-invalid={invalid(error)}
        aria-describedby={describedBy(name, field, error)}
        aria-label={field.label}
        aria-required={field.required || undefined}
      />
      <div className={cn('editlet-ff-json__status', `editlet-ff-json__status--${status}`)}>
        {status === 'empty'
          ? field.required
            ? 'Enter JSON…'
            : 'Optional — leave empty for no value'
          : status === 'valid'
            ? 'Valid JSON'
            : 'Invalid JSON'}
      </div>
    </Field>
  );
}
