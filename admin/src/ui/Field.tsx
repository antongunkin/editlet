import * as React from 'react';

import { cn } from './cn';
import { Icon } from './Icon';

export type FieldProps = {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** The control's id: the label points at it. */
  htmlFor?: string;
  /** Base of the hint and error ids (`<id>-hint`, `<id>-error`); defaults to `htmlFor`. */
  describedById?: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * The ids a control lists in `aria-describedby` for its field's hint and error, or `undefined` when it has neither.
 * `base` is the same id the Field got as `describedById` (or `htmlFor`).
 */
export function fieldDescribedBy(base: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${base}-hint` : null, error ? `${base}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * Labelled field, top to bottom: one label with the name (required `*`) and the hint next to it on the same line
 * (it wraps under the name when it does not fit), the control, then the error. Controls point at the hint and error with `aria-describedby` (see `fieldDescribedBy`).
 */
export function Field({ label, hint, error, required, htmlFor, describedById, className, children }: FieldProps) {
  const base = describedById ?? htmlFor;
  return (
    <div className={cn('editlet-field', className)}>
      {/* One label: a click on the name or the hint focuses the control. The hint stays out of the control's name
          (aria-hidden); it is read as the control's description through aria-describedby. */}
      <label htmlFor={htmlFor} className="editlet-field__head">
        <span className="editlet-field__label">
          {label}
          {required ? (
            <span className="editlet-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
        {hint ? (
          <span id={base ? `${base}-hint` : undefined} className="editlet-field__hint" aria-hidden="true">
            {hint}
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <div id={base ? `${base}-error` : undefined} className="editlet-field__error" role="alert">
          <Icon.X size={11} />
          {error}
        </div>
      ) : null}
    </div>
  );
}
