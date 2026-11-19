import type { DragEvent, ReactNode } from 'react';

import { cn } from '../ui/cn';
import { Icon } from '../ui/primitives/icon';

// The grid of the Media screen and of the Gallery (FigCraft *Media*, *Media · 600*, *Gallery*): square tiles with a
// 12 px radius, three to a row on a phone and five in the 600 px window (`wide:`, a container query on the screen's own
// width: the admin has no viewport of its own in a window). Props only: the container (MediaScreen.tsx) has the data.

export interface MediaGridProps {
  /** The tiles. */
  children: ReactNode;
  /** 4 px between tiles and 8 px at the sides on the screen (`dense`), 8 px and 16 px in the Gallery. */
  dense?: boolean;
  className?: string;
}

/** The container that decides the column count, and the grid in it. */
export function MediaGrid({ children, dense, className }: MediaGridProps) {
  return (
    <div className="@container">
      <div className={cn('grid grid-cols-3 wide:grid-cols-5', dense ? 'gap-1 px-2' : 'gap-2 px-4', className)}>
        {children}
      </div>
    </div>
  );
}

/** A flag on a picture: a solid pill, because a tint would not read over a photo (the badges are tints). */
function Flag({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full bg-card px-2 text-xs font-medium shadow-raised',
        warn ? 'text-tint-unsaved-foreground' : 'text-foreground',
      )}
    >
      {warn ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-chart-1" /> : null}
      {children}
    </span>
  );
}

export interface MediaTileProps {
  /** The picture (a `LazyPreview` with the image in it, or a stand-in on /design). */
  preview: ReactNode;
  /** The tile's accessible name: the file, where it sits, what it is used for. */
  label: string;
  /** The tooltip: the file's whole path. */
  path: string;
  /** The file name and its folder, under the picture. */
  caption?: { name: string; folder: string };
  /** Flags on the picture's corner: only what needs a look. */
  unused?: boolean;
  noAlt?: boolean;
  /** Select mode: the tile shows its check, filled when chosen. */
  selecting?: boolean;
  selected?: boolean;
  /** The image that is open (beside the grid): a ring. */
  active?: boolean;
  /** Cannot be chosen (used by an entry, or the index is still being read). */
  locked?: boolean;
  /** Files are being dragged over it. */
  dragging?: boolean;
  onClick?: () => void;
  /** The drop handlers of `useDropZone`. */
  drop?: {
    onDragEnter(e: DragEvent<HTMLElement>): void;
    onDragOver(e: DragEvent<HTMLElement>): void;
    onDragLeave(e: DragEvent<HTMLElement>): void;
    onDrop(e: DragEvent<HTMLElement>): void;
  };
}

/**
 * One image (FigCraft `MediaCard`): the picture, with its flags (Unused, No alt) at the bottom and, in select mode,
 * the check at the top left. The whole tile is the button. Keyboard focus, the open image and a drag over it are a
 * 2 px ring on the picture, drawn above it. With a `caption` (select mode, the Gallery: where two files can share a
 * name and a tooltip does not exist on a touch screen) the file name (it wraps at a word, and inside one only when it must) and its folder (one line, cut with an
 * ellipsis; the tooltip has all of it) are under the picture.
 */
export function MediaTile({
  preview,
  label,
  path,
  caption,
  unused,
  noAlt,
  selecting,
  selected,
  active,
  locked,
  dragging,
  onClick,
  drop,
}: MediaTileProps) {
  return (
    <button
      type="button"
      title={path}
      aria-label={label}
      aria-pressed={selecting ? selected : undefined}
      aria-current={!selecting && active ? 'true' : undefined}
      disabled={locked}
      onClick={onClick}
      data-dragging={dragging ? 'true' : undefined}
      className="group relative flex min-w-0 cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left font-sans outline-none disabled:cursor-default disabled:opacity-40"
      {...drop}
    >
      {caption ? (
        <span className="order-last flex min-w-0 flex-col px-0.5">
          <span className="text-sm font-medium wrap-break-word text-foreground">{caption.name}</span>{' '}
          <span className="truncate text-xs text-tray-muted-foreground" title={caption.folder}>
            {caption.folder}
          </span>
        </span>
      ) : null}{' '}
      <span className="relative block aspect-square w-full overflow-hidden rounded-xl bg-muted">
        {preview}
        <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex flex-wrap gap-1">
          {unused ? <Flag>Unused</Flag> : null}
          {noAlt ? <Flag warn>No alt</Flag> : null}
        </span>
        {selecting && !locked ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-2 left-2 flex size-7 items-center justify-center rounded-full',
              selected ? 'bg-gradient-ink text-on-ink shadow-ink-small' : 'bg-card shadow-raised',
            )}
          >
            {selected ? <Icon name="check" size={16} strokeWidth={2.5} /> : null}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        data-focus-ring=""
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 aspect-square rounded-xl',
          'group-hovered:bg-overlay/10 group-focused:inset-ring-2 group-focused:inset-ring-ring',
          (selected || active || dragging) && 'inset-ring-2 inset-ring-ring',
        )}
      />
    </button>
  );
}
