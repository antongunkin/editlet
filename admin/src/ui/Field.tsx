import * as React from 'react';
import { createContext, useContext } from 'react';

import { cn } from './cn';
import { Icon } from './primitives/icon';

/**
 * True inside a field's own modal: `Field` then hides its label (the modal's title says it) and puts the hint under the
 * control.
 */
export const FieldInSheet = createContext(false);

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
  if (useContext(FieldInSheet)) {
    // The field's own modal (screens/FieldSheet.tsx): its title is the label, so the label is only for assistive
    // technology, and the hint is a line under the control (FigCraft `hint`).
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <label htmlFor={htmlFor} className="sr-only">
          {label}
        </label>
        {children}
        {hint ? (
          <p id={base ? `${base}-hint` : undefined} className="m-0 px-1 text-sm text-tray-muted-foreground">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p
            id={base ? `${base}-error` : undefined}
            className="m-0 flex items-center gap-1.5 px-1 text-sm font-medium text-tint-danger-foreground"
            role="alert"
          >
            <Icon name="alert" size={16} className="shrink-0 text-destructive" />
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col', className)}>
      {/* One label: a click on the name or the hint focuses the control. The hint stays out of the control's name
          (aria-hidden); it is read as the control's description through aria-describedby. */}
      <label htmlFor={htmlFor} className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-base font-medium text-foreground">
          {label}
          {required ? (
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
        {hint ? (
          <span id={base ? `${base}-hint` : undefined} className="text-sm text-muted-foreground" aria-hidden="true">
            {hint}
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <div
          id={base ? `${base}-error` : undefined}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-destructive"
          role="alert"
        >
          <Icon name="x" size={16} />
          {error}
        </div>
      ) : null}
    </div>
  );
}
