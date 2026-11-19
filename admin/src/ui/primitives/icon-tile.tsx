import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { Icon, type IconSize } from './icon';
import type { IconName } from './icons';

import { cn } from '../cn';

/**
 * An icon on a rounded tile (FigCraft `IconTile/<icon>`): 32 and 40 px with a radius of 12, 56 px with a radius of 16
 * (the scale's steps), the muted fill or the danger tint.
 */
export const iconTileVariants = cva('inline-flex shrink-0 items-center justify-center text-foreground', {
  variants: {
    size: { 32: 'size-8 rounded-xl', 40: 'size-10 rounded-xl', 56: 'size-14 rounded-2xl' },
    tone: { neutral: 'bg-muted', danger: 'bg-tint-danger text-tint-danger-foreground' },
  },
  defaultVariants: { size: 40, tone: 'neutral' },
});

const ICON_SIZE: Record<32 | 40 | 56, IconSize> = { 32: 16, 40: 20, 56: 24 };

export interface IconTileProps
  extends Omit<ComponentProps<'span'>, 'children'>, Omit<VariantProps<typeof iconTileVariants>, 'size'> {
  name: IconName;
  size?: 32 | 40 | 56;
}

export function IconTile({ name, size = 40, tone, className, ...props }: IconTileProps) {
  return (
    <span data-slot="icon-tile" className={cn(iconTileVariants({ size, tone }), className)} {...props}>
      <Icon name={name} size={ICON_SIZE[size]} />
    </span>
  );
}
