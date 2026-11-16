import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field, FIELD_INPUT_CLASS } from '../ui';

type Option = { label: string; value: string };

function optionsOf(props: WidgetProps<unknown>): Option[] {
  return props.field.type === 'select' ? props.field.options : [];
}

/** Single `<select>`; an empty option unless required. A stored value outside the options stays selectable. */
export function SelectField(props: WidgetProps<string>) {
  const { name, field, value, onChange, onBlur, error } = props;
  const options = optionsOf(props);
  const unknown = value !== '' && !options.some((o) => o.value === value);
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <select
        id={name}
        name={name}
        className={FIELD_INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid(error)}
        aria-describedby={describedBy(name, field, error)}
        aria-label={field.label}
        aria-required={field.required || undefined}
      >
        {!field.required ? (
          <option value="">—</option>
        ) : value === '' ? (
          <option value="" disabled>
            Choose…
          </option>
        ) : null}
        {unknown ? <option value={value}>{value}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** `multiple: true` select as a checkbox list → `string[]`. */
export function MultiSelectField(props: WidgetProps<string[]>) {
  const { name, field, value, onChange, onBlur, error } = props;
  const options = optionsOf(props);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Field {...fieldProps(field, error, name)}>
      <ul id={name} className="editlet-ff-select__multi" aria-label={field.label}>
        {options.map((o) => (
          <li key={o.value}>
            <label className="editlet-ff-select__multi-label">
              <input
                type="checkbox"
                checked={value.includes(o.value)}
                onChange={() => toggle(o.value)}
                onBlur={onBlur}
                className="editlet-ff-select__multi-checkbox"
                aria-invalid={invalid(error)}
                aria-describedby={describedBy(name, field, error)}
              />
              <span>{o.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </Field>
  );
}
