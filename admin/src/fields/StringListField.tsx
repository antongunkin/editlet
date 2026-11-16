import { useState } from 'react';

import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { cn, Field, Icon } from '../ui';

/** List of strings: type a value and press Enter (or blur) to add a row; × removes a row. */
export function StringListField({ name, field, value, onChange, onBlur, error }: WidgetProps<string[]>) {
  const [draft, setDraft] = useState('');

  const commitDraft = () => {
    const next = draft.trim();
    if (next === '') return;
    onChange([...value, next]);
    setDraft('');
  };

  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <input
        id={name}
        className={cn('editlet-ff-list__add-input', invalid(error) && 'editlet-ff-list__add-input--error')}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDraft();
          }
        }}
        onBlur={() => {
          commitDraft();
          onBlur?.();
        }}
        placeholder="Type the value and hit enter"
        aria-invalid={invalid(error)}
        aria-describedby={describedBy(name, field, error)}
        aria-label={field.label}
        aria-required={field.required || undefined}
      />
      {value.length > 0 ? (
        <ul className="editlet-ff-list__items">
          {value.map((item, i) => (
            // oxlint-disable-next-line no-array-index-key -- rows may repeat; position is the identity
            <li key={i} className="editlet-ff-list__item">
              <span className="editlet-ff-list__item-value">{item}</span>
              <span className="editlet-ff-list__item-sep" aria-hidden />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="editlet-ff-list__item-remove"
                aria-label={`Remove ${item}`}
              >
                <Icon.X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  );
}
