import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Field } from '../ui';
import { Checkbox } from '../ui/primitives/checkbox';

type Option = { label: string; value: string };

function optionsOf(props: WidgetProps<unknown>): Option[] {
  return props.field.type === 'select' ? props.field.options : [];
}

/** `multiple: true` select as a checkbox list → `string[]`: each option a 44 px checkbox, its label beside it. */
export function MultiSelectField(props: WidgetProps<string[]>) {
  const { name, field, value, onChange, onBlur, error } = props;
  const options = optionsOf(props);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Field {...fieldProps(field, error, name)}>
      <ul id={name} className="-ml-2.5 flex flex-col" aria-label={field.label}>
        {options.map((o) => (
          <li key={o.value}>
            <label className="inline-flex cursor-pointer items-center text-base">
              <Checkbox
                checked={value.includes(o.value)}
                onCheckedChange={() => toggle(o.value)}
                onBlur={onBlur}
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
