import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { Icon } from './icon';
import type { IconName } from './icons';

import { cn } from '../cn';

/**
 * A message that stays on the screen until it is dealt with (FigCraft `Banner/<tone>`, proposal §14.9): a 16 px radius
 * card on the state's tint with the state's icon, 14 px medium text and an optional action. The tone says what kind:
 * `unsaved` (amber: changed on disk or on GitHub), `danger` (red: can't reach, failed), `branch` (violet: where you are),
 * `success` (green). The colour never stands alone: the words say it.
 */
export const bannerVariants = cva('flex items-center gap-3 rounded-2xl py-3 pr-3 pl-4 text-sm font-medium', {
  variants: {
    tone: {
      unsaved: 'bg-tint-unsaved text-tint-unsaved-foreground',
      danger: 'bg-tint-danger text-tint-danger-foreground',
      branch: 'bg-tint-branch text-tint-branch-foreground',
      success: 'bg-tint-success text-tint-success-foreground',
    },
  },
  defaultVariants: { tone: 'unsaved' },
});

export type BannerTone = NonNullable<VariantProps<typeof bannerVariants>['tone']>;

const ICON: Record<BannerTone, IconName> = {
  unsaved: 'alert',
  danger: 'alert',
  branch: 'branch',
  success: 'check-circle',
};

export interface BannerProps extends Omit<ComponentProps<'div'>, 'children'> {
  tone?: BannerTone;
  /** What to do about it: a `Button`, or a link. */
  action?: ReactNode;
  children?: ReactNode;
}

export function Banner({ tone = 'unsaved', action, className, children, ...props }: BannerProps) {
  return (
    <div data-slot="banner" className={cn(bannerVariants({ tone }), className)} {...props}>
      <Icon name={ICON[tone]} size={20} className="shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/**
 * A live region that exists from the start. A screen reader announces text that is *added* to a region that was already
 * on the page; a region created together with its text is often missed. Put the banners that come and go inside one:
 * each is announced once when it appears, and not again while it stays. `assertive` for errors (it interrupts), polite
 * for notices. It has no role of its own, only `aria-live`.
 */
export function BannerRegion({
  assertive = false,
  className,
  ...props
}: ComponentProps<'div'> & { assertive?: boolean }) {
  return (
    <div
      data-slot="banner-region"
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-relevant="additions text"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}
