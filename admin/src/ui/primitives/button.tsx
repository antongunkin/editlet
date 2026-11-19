import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { Icon } from './icon';

import { cn } from '../cn';

/**
 * The button of the redesign (FigCraft `Button/<variant>/<size>/<state>`, proposal §14.9; docs/admin/ui.md). shadcn's
 * Base UI button, restyled: a pill with the design's gradients and shadows. States are the `hovered`, `pressed` and
 * `focused` variants of app.css, so the /design boards can show them all at once. Pressing scales to .96 and
 * collapses the shadow (100 ms), releasing springs back (220 ms); reduced motion keeps opacity only.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border-0 px-5 py-0 no-underline',
    'font-sans font-medium whitespace-nowrap select-none outline-none',
    'transition duration-220 ease-release',
    'pressed:scale-96 pressed:duration-100 pressed:ease-press',
    'focused:inset-ring-2 focused:outline-2 focused:outline-transparent',
    'data-disabled:not-aria-busy:opacity-40 aria-busy:opacity-60 data-disabled:cursor-default aria-busy:cursor-default',
    'motion-reduce:transition-opacity motion-reduce:pressed:scale-100',
    'forced-colors:border',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-gradient-ink text-on-ink shadow-button-primary',
          'hovered:bg-gradient-ink-hover pressed:shadow-button-primary-pressed focused:inset-ring-on-ink',
        ],
        danger: [
          'bg-gradient-danger text-on-ink shadow-button-danger',
          'hovered:bg-gradient-danger-hover pressed:shadow-button-danger-pressed focused:inset-ring-on-ink',
        ],
        secondary: [
          'bg-card text-foreground shadow-raised',
          'hovered:bg-sunken pressed:bg-background pressed:shadow-raised-pressed focused:inset-ring-foreground',
        ],
        ghost: [
          'bg-transparent text-foreground',
          'hovered:bg-accent pressed:bg-muted-active focused:bg-card focused:inset-ring-foreground',
        ],
        'ghost-danger': [
          'bg-transparent text-tint-danger-foreground',
          'hovered:bg-tint-danger pressed:bg-tint-danger focused:bg-card focused:inset-ring-foreground',
        ],
        link: 'h-auto bg-transparent px-0 text-foreground underline-offset-4 hovered:underline focused:inset-ring-foreground',
      },
      size: {
        sm: 'h-8 text-sm [&_svg]:size-4',
        md: 'h-11 text-base [&_svg]:size-5',
        lg: 'h-12 text-base [&_svg]:size-5',
      },
      full: { true: 'w-full' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends Omit<ButtonPrimitive.Props, 'className'> {
  className?: string;
  variant?: ButtonVariant;
  /** sm 32, md 44 (the default: the minimum target), lg 48 (the bottom bar's one CTA). */
  size?: ButtonSize;
  /** As wide as its container (the bottom bar's one CTA). */
  full?: boolean;
  /** Busy: a spinner, `aria-busy`, not clickable but still focusable (§14.9: only buttons have a loading state). */
  loading?: boolean;
  /** The label while loading (`Saving…`); the children otherwise. */
  busyLabel?: ReactNode;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  full,
  loading = false,
  busyLabel,
  icon,
  iconRight,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      type={type}
      disabled={disabled || loading}
      focusableWhenDisabled={loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, full }), className)}
      {...props}
    >
      {loading ? (
        <>
          <Icon name="loader" className="animate-spin motion-reduce:animate-none" />
          {busyLabel ?? children}
        </>
      ) : (
        <>
          {icon}
          {children}
          {iconRight}
        </>
      )}
    </ButtonPrimitive>
  );
}
