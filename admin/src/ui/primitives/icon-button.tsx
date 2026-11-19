import type { ReactNode } from 'react';

import { Button, type ButtonProps } from './button';

import { cn } from '../cn';

export interface IconButtonProps extends Omit<
  ButtonProps,
  'children' | 'icon' | 'iconRight' | 'size' | 'full' | 'variant' | 'busyLabel'
> {
  /** The icon (an `<Icon />`): a slot, as in the design. */
  icon: ReactNode;
  /** What it does: its accessible name and its tooltip. Required, so no icon button is unnamed. */
  label: string;
  /** `account` is the avatar button: ghost, but with no fill under the focus ring. */
  variant?: 'ghost' | 'secondary' | 'account';
}

/**
 * A 44 × 44 round icon button (FigCraft `IconButton/<state>`): header actions, back, a modal's ×, a field's clear
 * button. Ghost by default: transparent at rest, a 7 % ink fill on hover, 12 % pressed, the ring on keyboard focus.
 */
export function IconButton({ icon, label, variant = 'ghost', className, ...props }: IconButtonProps) {
  return (
    <Button
      variant={variant === 'account' ? 'ghost' : variant}
      size="md"
      aria-label={label}
      title={label}
      className={cn('size-11 px-0', variant === 'account' && 'focused:bg-transparent', className)}
      {...props}
    >
      {icon}
    </Button>
  );
}
