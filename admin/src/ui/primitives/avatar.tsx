import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../cn';

/**
 * A person's picture (FigCraft `Avatar/disc` 32 px, `Avatar/large` 56 px): the image, or until it loads (or when it
 * never does) the first letter of the name on the track colour. shadcn's avatar on Base UI.
 */
export const avatarVariants = cva(
  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-track font-semibold text-foreground select-none',
  {
    variants: { size: { disc: 'size-8 text-sm', large: 'size-14 text-2xl' } },
    defaultVariants: { size: 'disc' },
  },
);

export interface AvatarProps
  extends Omit<AvatarPrimitive.Root.Props, 'className' | 'children'>, VariantProps<typeof avatarVariants> {
  className?: string;
  /** The picture's URL. */
  src?: string;
  /** Whose it is: the fallback is its first letter. The picture itself is decoration (`alt=""`). */
  name: string;
}

export function Avatar({ className, size, src, name, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root data-slot="avatar" className={cn(avatarVariants({ size }), className)} {...props}>
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback aria-hidden="true">{name.slice(0, 1).toUpperCase()}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
