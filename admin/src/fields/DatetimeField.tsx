import { useRef } from 'react';

import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, Icon } from '../ui';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T/;

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const DATETIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const pad = (n: number) => String(n).padStart(2, '0');

/** The moment a stored value means; a value without a zone is read in the editor's time zone. `undefined` if unreadable. */
export function parseStored(value: string, dateOnly: boolean): Date | undefined {
  if (dateOnly) {
    const m = DATE.exec(value);
    if (!m) return undefined;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return date.getMonth() === Number(m[2]) - 1 ? date : undefined;
  }
  if (!DATETIME.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** What the field shows: the date in the editor's locale and time zone; a value that cannot be read stays as stored. */
export function formatStored(value: string, dateOnly: boolean): string {
  const date = parseStored(value, dateOnly);
  if (!date) return value;
  return (dateOnly ? DATE_FORMAT : DATETIME_FORMAT).format(date);
}

/** The value of the native picker for a date: local `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
export function toPickerValue(date: Date, dateOnly: boolean): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return dateOnly ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What is stored for a picked value: `YYYY-MM-DD` with `dateOnly`, else UTC ISO 8601 (`2026-01-15T09:00:00Z`). */
export function fromPickerValue(picked: string, dateOnly: boolean): string {
  if (picked === '' || dateOnly) return picked;
  const date = new Date(picked);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace('.000Z', 'Z');
}

/**
 * The date, formatted with Intl in a read-only input. A click anywhere on the pill (or Enter, Space, ↓ on the input)
 * opens the browser's own picker; Backspace or Delete clears the value.
 */
export function DatetimeField({ name, field, value, onChange, onBlur, error }: WidgetProps<string>) {
  const dateOnly = field.type === 'datetime' && field.dateOnly === true;
  const pickerRef = useRef<HTMLInputElement>(null);
  const date = parseStored(value, dateOnly);
  const open = () => {
    try {
      pickerRef.current?.showPicker();
    } catch {
      // Needs a user gesture and a browser that has showPicker; the field still shows the date.
    }
  };
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the input inside takes the keys */}
      <div className="editlet-input editlet-input--affixed editlet-ff-datetime" onClick={open}>
        <input
          id={name}
          className="editlet-input__inner"
          type="text"
          name={name}
          readOnly
          value={formatStored(value, dateOnly)}
          placeholder={dateOnly ? 'Select a date' : 'Select a date and time'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              open();
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
              e.preventDefault();
              onChange('');
            }
          }}
          onBlur={onBlur}
          aria-invalid={invalid(error)}
          aria-describedby={describedBy(name, field, error)}
          aria-label={field.label}
          aria-required={field.required || undefined}
        />
        <span className="editlet-input__affix" aria-hidden="true">
          <Icon.Calendar size={16} />
        </span>
        <input
          ref={pickerRef}
          className="editlet-ff-datetime__picker"
          type={dateOnly ? 'date' : 'datetime-local'}
          tabIndex={-1}
          aria-hidden="true"
          value={date ? toPickerValue(date, dateOnly) : ''}
          onChange={(e) => onChange(fromPickerValue(e.target.value, dateOnly))}
        />
      </div>
    </Field>
  );
}
