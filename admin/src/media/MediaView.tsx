import type { ReactNode } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import { BigTitle } from '../ui/parts/header';

// The Media screen as the design draws it (FigCraft *Media*, *Media · select*, *Media · 600* and *Media · image*): a
// header, the filter chips, the grid and a bottom bar with the status line and the one CTA; one image has a big title,
// its picture, where it is used and its alt text. Props only: the container (MediaScreen.tsx) has the data, and /design
// renders both from fixtures (src/design/fixtures/media.tsx).

interface FrameProps {
  /** The `Header` (or the `SearchHeader` while searching). */
  header: ReactNode;
  /** Notices under the header (the shell's, an upload that was skipped, a commit that failed). */
  banners?: ReactNode;
  /** Between the header and the scrolling content, which stays in place (the filter chips). */
  top?: ReactNode;
  /** The content. */
  children: ReactNode;
  /** The bottom bar's status line (`StatusChips`). */
  status?: ReactNode;
  /** The bottom bar's one CTA, and a secondary button beside it (*Done* in select mode). */
  cta?: ReactNode;
  secondary?: ReactNode;
  /** The screen's modals (the ⋯ action sheet, the confirms, the commit's new-branch sheet). */
  modals?: ReactNode;
  /** Files are being dragged over the screen. */
  dragging?: boolean;
  dropHandlers?: Record<string, unknown>;
}

function Frame({ header, banners, top, children, status, cta, secondary, modals, dragging, dropHandlers }: FrameProps) {
  return (
    <section
      data-editlet="screen"
      data-dragging={dragging ? 'true' : undefined}
      className="relative flex min-h-0 flex-1 flex-col bg-background text-foreground data-dragging:-outline-offset-2 data-dragging:outline-2 data-dragging:outline-ring data-dragging:outline-dashed"
      {...dropHandlers}
    >
      {header}
      {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
      {top}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      <BottomBar status={status} className="shrink-0">
        {secondary}
        {cta}
      </BottomBar>
      {modals}
    </section>
  );
}

export interface MediaViewProps extends Omit<FrameProps, 'children' | 'top'> {
  /** The filter chips. */
  filters: ReactNode;
  /** A line over the grid (select mode: *Only unused images can be selected.*). */
  hint?: ReactNode;
  /** The grid of tiles, or what stands in for it (loading, no images, no match). */
  body: ReactNode;
}

/** The grid screen. */
export function MediaView({ filters, hint, body, ...frame }: MediaViewProps) {
  return (
    <Frame {...frame} top={<div className="flex px-4">{filters}</div>}>
      {hint ? <p className="m-0 px-4 pb-3 text-sm text-tray-muted-foreground">{hint}</p> : null}
      <div className="pb-8">{body}</div>
    </Frame>
  );
}

export interface MediaImageViewProps extends Omit<FrameProps, 'children' | 'top' | 'dragging' | 'dropHandlers'> {
  /** The file name: the page's `h1`. */
  title: string;
  /** *77 KB · 1600 × 900 · image/jpeg* */
  facts: ReactNode;
  /** The picture (with its magnifier). */
  preview: ReactNode;
  /** The file's repository path. */
  path: string;
  /** *Used in 1 place*, then the uses (rows with their alt text) or the sentence for an unused image. */
  uses: ReactNode;
}

/** One image: where it is used, its alt text; Replace and Delete are in ⋯. */
export function MediaImageView({ title, facts, preview, path, uses, ...frame }: MediaImageViewProps) {
  return (
    <Frame {...frame}>
      <BigTitle as="h1" title={title} meta={facts} />
      <div className="flex flex-col gap-4 px-4 pb-8">
        <div className="relative">{preview}</div>
        <code className="font-mono text-xs break-all text-tray-muted-foreground">{path}</code>
        {uses}
      </div>
    </Frame>
  );
}
