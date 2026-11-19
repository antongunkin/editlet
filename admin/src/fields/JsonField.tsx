import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { cn, Field, Textarea } from '../ui';

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
/** The status line's colour: muted while empty, green when it parses, red when it does not. */
const STATUS_TONE = { empty: 'text-muted-foreground', valid: 'text-chart-2', invalid: 'text-destructive' } as const;

export function JsonField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  const status = syntaxStatus(value);
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <Textarea
        id={name}
        className="min-h-40 font-mono leading-7"
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
      <div className={cn('mt-1.5 text-sm', STATUS_TONE[status])}>
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
