import * as React from 'react';

/** A text input, date input or `<select>`: one pill-shaped element. `aria-invalid="true"` turns the outline red. */
export const FIELD_INPUT_CLASS = 'editlet-input';

export const FIELD_TEXTAREA_CLASS = 'field-textarea editlet-textarea';

export type PrefixedInputProps = React.InputHTMLAttributes<HTMLInputElement> & { prefix: string };

/** A pill with fixed text before the input (`editlet/`). A label, so a click on the prefix focuses the input. */
export function PrefixedInput({ prefix, ...props }: PrefixedInputProps) {
  return (
    <label className="editlet-input editlet-input--affixed">
      <span className="editlet-input__affix" aria-hidden="true">
        {prefix}
      </span>
      <input {...props} className="editlet-input__inner" />
    </label>
  );
}
