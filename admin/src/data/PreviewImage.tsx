import type { ReactEventHandler } from 'react';

import { cn } from '../ui/cn';
import { buttonVariants } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';

/** The big preview of a modal or a page (FigCraft *Edit · Cover image*, *Media · image*): 160 px high, the full width, cropped. */
export const BIG_PREVIEW = 'block h-40 w-full rounded-2xl object-cover';

export type PreviewImageProps = {
  url: string;
  alt: string;
  /** The image's size and fit. None by default: the rich text body styles its own images (`richtext.css`). */
  className?: string;
  /** Adds a magnifier link over the image that opens it in a new window. */
  openable?: boolean;
  onLoad?: ReactEventHandler<HTMLImageElement>;
};

/** An `<img>` for an object URL; with `openable`, a magnifier link in the corner opens the image in a new window. */
export function PreviewImage({ url, alt, className, openable, onLoad }: PreviewImageProps) {
  return (
    <>
      <img src={url} alt={alt} onLoad={onLoad} className={className} />
      {openable ? (
        <a
          className={cn(buttonVariants({ variant: 'secondary' }), 'absolute top-2 right-2 size-11 px-0')}
          href={url}
          target="_blank"
          rel="noopener"
          aria-label="Open image in a new window"
          title="Open image in a new window"
        >
          <Icon name="zoom-in" size={20} />
        </a>
      ) : null}
    </>
  );
}

/**
 * What stands in for an image that is loading, not listed, or not there: a muted box with the image icon, 96 × 64 px
 * unless `className` sizes it.
 */
export function ImagePlaceholder({ alt, className }: { alt: string; className?: string }) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- stands in for an <img> that has not loaded or has no source: a box with the name, no src
      role="img"
      aria-label={alt || 'No image'}
      className={cn(
        'flex items-center justify-center bg-muted text-muted-foreground',
        className ?? 'h-16 w-24 rounded-md',
      )}
    >
      <Icon name="image" size={24} />
    </div>
  );
}
