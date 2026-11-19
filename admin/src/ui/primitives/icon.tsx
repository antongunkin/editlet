import type { SVGProps } from 'react';

import { ICONS, type IconName } from './icons';

export type IconSize = 16 | 20 | 24;

export type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  'name' | 'children' | 'color' | 'width' | 'height' | 'viewBox' | 'role' | 'aria-label' | 'aria-hidden'
> & {
  /** A name from `design/tokens.json` → `icon` (the generated `icons.ts`). */
  name: IconName;
  /** On the design's 24 grid: 16, 20 or 24 px. */
  size?: IconSize;
  strokeWidth?: number;
  /** The icon's accessible name. Without it the icon is decoration and hidden from assistive technology. */
  label?: string;
};

/** One of the design's icons: a single stroked path in `currentColor`. */
export function Icon({ name, size = 24, strokeWidth = 2, label, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...props}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
