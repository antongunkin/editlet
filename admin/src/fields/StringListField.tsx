import { useState } from 'react';

import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, Icon, IconButton, Input } from '../ui';

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
      <Input
        id={name}
        className="mb-2"
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
        <ul className="mb-2 flex flex-col gap-1.5">
          {value.map((item, i) => (
            // oxlint-disable-next-line no-array-index-key -- rows may repeat; position is the identity
            <li key={i} className="flex items-center rounded-xl bg-muted text-base">
              <span className="min-w-0 flex-1 truncate px-3 py-2">{item}</span>
              <IconButton
                label={`Remove ${item}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                icon={<Icon name="x" size={16} />}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  );
}
