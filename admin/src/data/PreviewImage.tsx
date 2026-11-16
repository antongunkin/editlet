import { buttonVariants } from '../ui/Button';
import { cn } from '../ui/cn';
import { Icon } from '../ui/Icon';

export type PreviewImageProps = {
  url: string;
  alt: string;
  className?: string;
  /** Adds a magnifier link over the image that opens it in a new window. */
  openable?: boolean;
};

/** An `<img>` for an object URL; with `openable`, a magnifier link in the corner opens the image in a new window. */
export function PreviewImage({ url, alt, className, openable }: PreviewImageProps) {
  return (
    <>
      <img src={url} alt={alt} className={className} />
      {openable ? (
        <a
          className={cn(buttonVariants({ variant: 'outline', size: 'sm', iconOnly: true }), 'editlet-ff-image__open')}
          href={url}
          target="_blank"
          rel="noopener"
          aria-label="Open image in a new window"
          title="Open image in a new window"
        >
          <Icon.ZoomIn size={20} />
        </a>
      ) : null}
    </>
  );
}
