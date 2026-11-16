import * as React from 'react';

import { cn } from './cn';

export type ButtonVariant = 'default' | 'primary' | 'destructive' | 'outline' | 'ghost' | 'action';
/** `md` is the default (40px tall); `sm` is 32px. */
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A round button with an icon and no label: as wide as it is tall. */
  iconOnly?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export function buttonVariants({
  variant = 'default',
  size = 'md',
  iconOnly = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; className?: string } = {}): string {
  return cn(
    'editlet-button',
    `editlet-button--${variant}`,
    size === 'sm' && 'editlet-button--sm',
    iconOnly && 'editlet-button--icon',
    className,
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'default', size = 'md', iconOnly, type = 'button', icon, iconRight, children, ...props },
    ref,
  ) => (
    <button ref={ref} type={type} className={buttonVariants({ variant, size, iconOnly, className })} {...props}>
      {icon ? <span className="editlet-button__icon">{icon}</span> : null}
      {children}
      {iconRight ? <span className="editlet-button__icon">{iconRight}</span> : null}
    </button>
  ),
);
Button.displayName = 'Button';
