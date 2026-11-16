import { describedBy, fieldProps } from './shared';
import type { WidgetProps } from './types';

import { cn, Field } from '../ui';

const DEFAULT_TRUE = 'Yes';
const DEFAULT_FALSE = 'No';

/** Segmented Yes/No toggle. `undefined` (absent) shows neither segment active. */
export function BooleanField({ name, field, value, onChange, onBlur, error }: WidgetProps<boolean | undefined>) {
  const labels = field.type === 'boolean' && field.labels ? field.labels : { true: DEFAULT_TRUE, false: DEFAULT_FALSE };
  const segment = (on: boolean, text: string) => {
    const active = value === on;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange(on)}
        onBlur={onBlur}
        className={cn(
          'editlet-ff-boolean__seg',
          active ? 'editlet-ff-boolean__seg--active' : 'editlet-ff-boolean__seg--inactive',
        )}
      >
        {text}
      </button>
    );
  };
  return (
    <Field {...fieldProps(field, error, name)}>
      <div
        id={name}
        className="editlet-ff-boolean__track"
        role="group"
        aria-label={field.label}
        aria-describedby={describedBy(name, field, error)}
      >
        {segment(true, labels.true)}
        {segment(false, labels.false)}
      </div>
    </Field>
  );
}
