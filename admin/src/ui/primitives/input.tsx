import { Input as InputPrimitive } from '@base-ui/react/input';
import { cva } from 'class-variance-authority';
import { createContext, useContext, type ComponentProps, type ReactNode, type Ref } from 'react';

import { Icon } from './icon';

import { cn } from '../cn';

/**
 * The text input of the redesign (FigCraft `Input/<state>`, proposal §14.9; docs/admin/ui.md): a 48 px white pill lifted
 * by the raised shadow, 18 px text (no zoom on iOS), no edge. `focused:` matches every focus of a text input (a text
 * field always shows `:focus-visible`), so clicking in it shows the 2 px ink ring too; the design's caret-only "typing"
 * look is the unfocused field. `aria-invalid` is a 2 px red ring; read-only and disabled are flat. With several lines
 * (`multiline`) the radius is 24. One class set for `<input>`, `<textarea>`, `<select>` and the group's pill.
 * `readOnlyLook: false` for what `:read-only` also matches but is not an input being read-only (a `<select>`, the group's
 * label).
 */
export const inputVariants = cva(
  [
    'box-border block min-w-0 w-full rounded-full border-0 bg-card px-5 py-0 font-sans text-lg font-normal text-foreground shadow-raised outline-none',
    'placeholder:text-muted-foreground transition-shadow duration-150 ease-release',
    'hovered:shadow-raised-hover',
    'focused:inset-ring-2 focused:inset-ring-foreground',
    'aria-invalid:inset-ring-2 aria-invalid:inset-ring-destructive',
    'disabled:cursor-not-allowed disabled:bg-background disabled:opacity-50 disabled:shadow-none',
    'forced-colors:border',
  ],
  {
    variants: {
      multiline: { false: 'h-12', true: 'min-h-30 rounded-3xl py-3.5 leading-normal' },
      readOnlyLook: { true: 'read-only:bg-background read-only:shadow-none read-only:hovered:shadow-none', false: '' },
    },
    defaultVariants: { multiline: false, readOnlyLook: true },
  },
);

export type InputProps = ComponentProps<typeof InputPrimitive>;

/** A single-line text input (shadcn's Base UI input, restyled). */
export function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={
        typeof className === 'function'
          ? (state) => cn(inputVariants(), className(state))
          : cn(inputVariants(), className)
      }
      {...props}
    />
  );
}

export type TextareaProps = Omit<ComponentProps<'textarea'>, 'ref'> & { ref?: Ref<HTMLTextAreaElement> };

/** A multi-line input: the same pill with a 24 px radius. */
export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea data-slot="textarea" className={cn(inputVariants({ multiline: true }), className)} {...props} />;
}

const GroupDisabled = createContext(false);

const groupInput =
  'h-full w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-lg font-normal text-foreground outline-none placeholder:text-muted-foreground';

/** The bare field of an `InputGroup`: no shape of its own, the group is the pill. It is disabled with its group. */
export function InputGroupInput({ className, disabled, ...props }: InputProps) {
  const groupDisabled = useContext(GroupDisabled);
  return (
    <InputPrimitive
      data-slot="input-group-input"
      className={
        typeof className === 'function' ? (state) => cn(groupInput, className(state)) : cn(groupInput, className)
      }
      disabled={disabled || groupDisabled}
      {...props}
    />
  );
}

export interface InputGroupProps extends Omit<ComponentProps<'label'>, 'prefix'> {
  /** An icon before the field (a search icon). */
  lead?: ReactNode;
  /** Text before the field, such as `editlet/`. */
  prefix?: string;
  /** A control after the field: a clear button, a calendar icon. */
  trail?: ReactNode;
  /** Busy: a spinner after the field and `aria-busy`. */
  loading?: boolean;
  /** The field is disabled: the pill is flat and dimmed (`:has(:disabled)` would also match a disabled `trail`). */
  disabled?: boolean;
}

/**
 * A pill around an `InputGroupInput` with something beside it. A label, so a click anywhere on the pill (the prefix
 * too) focuses the field. Keyboard focus and `aria-invalid` of the field show on the pill.
 */
export function InputGroup({
  lead,
  prefix,
  trail,
  loading = false,
  disabled = false,
  className,
  children,
  ...props
}: InputGroupProps) {
  return (
    <label
      data-slot="input-group"
      data-focus-ring=""
      aria-busy={loading || undefined}
      data-disabled={disabled ? '' : undefined}
      className={cn(
        inputVariants({ readOnlyLook: false }),
        'flex cursor-text items-center gap-2',
        lead ? 'pl-4' : null,
        trail ? 'pr-0.5' : null,
        'has-focus-visible:inset-ring-2 has-focus-visible:inset-ring-foreground',
        'has-aria-invalid:inset-ring-2 has-aria-invalid:inset-ring-destructive',
        disabled ? 'cursor-not-allowed bg-background opacity-50 shadow-none' : null,
        className,
      )}
      {...props}
    >
      <GroupDisabled value={disabled}>
        {lead ? <span className="inline-flex shrink-0 items-center text-muted-foreground">{lead}</span> : null}
        {prefix ? (
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        {children}
        {loading ? (
          <Icon
            name="loader"
            size={20}
            className="shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        ) : (
          trail
        )}
      </GroupDisabled>
    </label>
  );
}

export interface CounterProps extends ComponentProps<'span'> {
  count: number;
  max: number;
}

/** `118 / 160` under a multi-line input, right-aligned. */
export function Counter({ count, max, className, ...props }: CounterProps) {
  return (
    <span className={cn('ml-auto text-sm font-medium text-muted-foreground tabular-nums', className)} {...props}>
      {count} / {max}
    </span>
  );
}
