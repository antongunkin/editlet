import type { ReactNode, RefObject } from 'react';

import { BottomBar, Banner, Button, Icon, IconTile, Input, Progress, Sheet } from '../ui';

// The missing alt queue as the design draws it (FigCraft *Media · alt queue*, *· typing*, *· last*, *· done*): a sheet
// with the progress, one image (its thumbnail, name and where it is used), *Open image ›*, the Alt text field with
// *Skip* under it, and the bar's one CTA; at the end the summary. Props only: `AltQueue` has the data, and /design
// renders it from fixtures (src/design/fixtures/media.tsx).

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface AltQueueImage {
  name: string;
  /** The thumbnail (`AssetPreview` in the admin, a gradient on /design), 56 px. */
  picture: ReactNode;
  /** One line per use without alt: *Post · Cover · Tires for a rigid bike*. */
  uses: string[];
  /** How many more places there are than `uses` lists. */
  moreUses?: number;
}

export interface AltQueueSummary {
  saved: number;
  skipped: number;
  already?: number;
}

export interface AltQueueViewProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The image on show (`position` of `total`); `null` at the end, with `summary`. */
  image: AltQueueImage | null;
  position: number;
  total: number;
  summary?: AltQueueSummary;
  alt: string;
  onAlt(alt: string): void;
  /** The field, so the sheet can take the focus into it. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** The id of the field and of its hint (the label and `aria-describedby`). */
  fieldId: string;
  hintId: string;
  /** Enter in the field, and the bar's CTA: save and go on. */
  onSave(): void;
  onSkip(): void;
  onOpenImage(): void;
  /** *Go through N skipped*, and *Done*. */
  onAgain(): void;
  onDone(): void;
  /** A commit (or the read before it) is running: the CTA is *Saving…* and the way out is shut. */
  busy?: boolean;
  error?: string | null;
  /** What the live region says. */
  announcement?: string;
  /** Rendered inside the sheet: the commit's new-branch sheet, one level up. */
  children?: ReactNode;
}

/** The queue's sheet. */
export function AltQueueView({
  open,
  onOpenChange,
  image,
  position,
  total,
  summary,
  alt,
  onAlt,
  inputRef,
  fieldId,
  hintId,
  onSave,
  onSkip,
  onOpenImage,
  onAgain,
  onDone,
  busy,
  error,
  announcement,
  children,
}: AltQueueViewProps) {
  const last = position === total;
  const body = !image ? (
    <div className="flex flex-col items-center gap-3 px-4 pt-10 pb-6 text-center">
      <IconTile name="check-circle" size={56} tone="success" />
      <h2 className="m-0 text-lg font-semibold">All done</h2>
      <p className="m-0 text-base text-tray-muted-foreground">
        {[
          count(summary?.saved ?? 0, 'alt text saved', 'alt texts saved'),
          summary?.skipped ? `${summary.skipped} skipped` : null,
          summary?.already ? `${summary.already} already had alt text` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  ) : (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
      <Progress value={position} max={total} />
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">{image.picture}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="m-0 truncate text-base font-medium">{image.name}</p>
          {image.uses.map((line) => (
            <p key={line} className="m-0 truncate text-sm text-tray-muted-foreground">
              {line}
            </p>
          ))}
          {image.moreUses ? (
            <p className="m-0 text-sm text-tray-muted-foreground">+{image.moreUses} more places</p>
          ) : null}
        </div>
      </div>
      <Button
        variant="ghost"
        className="self-start"
        iconRight={<Icon name="chevron-right" size={16} />}
        disabled={busy}
        onClick={onOpenImage}
      >
        Open image
      </Button>
      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId} className="px-1 text-sm font-medium text-tray-muted-foreground">
          Alt text for {image.name}
        </label>
        <Input
          ref={inputRef}
          id={fieldId}
          value={alt}
          autoComplete="off"
          enterKeyHint={last ? 'done' : 'next'}
          aria-describedby={hintId}
          onChange={(e) => onAlt(e.target.value)}
          onKeyDown={(e) => {
            // keyCode 229: Safari's Enter that commits an IME composition has `isComposing` already false.
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            e.preventDefault();
            onSave();
          }}
        />
        <p id={hintId} className="m-0 px-1 text-sm text-tray-muted-foreground">
          Describe the image for people who cannot see it.
        </p>
        {/* In the content, not the bar: on iOS the bar of a sheet with a focused field hides under Safari's form
          accessory, and in the queue the field keeps the focus. */}
        <Button variant="ghost" className="self-end" disabled={busy} onClick={onSkip}>
          Skip
        </Button>
      </div>
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
    </div>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Missing alt"
      sub={`${image ? position : total} of ${total}`}
      initialFocus={inputRef}
      bar={
        <BottomBar>
          {image ? (
            <Button
              variant="primary"
              size="lg"
              full
              loading={busy}
              busyLabel="Saving…"
              disabled={alt.trim() === ''}
              onClick={onSave}
            >
              {last ? 'Save & finish' : 'Save & next'}
            </Button>
          ) : (
            <>
              {summary?.skipped ? (
                <Button size="lg" onClick={onAgain}>
                  Go through {summary.skipped} skipped
                </Button>
              ) : null}
              <Button variant="primary" size="lg" full onClick={onDone}>
                Done
              </Button>
            </>
          )}
        </BottomBar>
      }
    >
      {body}
      <output className="sr-only">{announcement}</output>
      {children}
    </Sheet>
  );
}
