import type { ReactNode } from 'react';

import { FieldDiffList } from '../diff/FieldDiff';
import type { FieldDiffRow } from '../entry/diff';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import type { FinalFocus } from '../ui/parts/focus';
import { RowChevron, RowText, rowVariants } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { Avatar } from '../ui/primitives/avatar';
import { Button } from '../ui/primitives/button';
import { IconTile } from '../ui/primitives/icon-tile';

// History and History · version (FigCraft *History*, *History · version*; docs/admin/history.md): the versions of an
// entry from git, newest first, and one version's diff against the entry with *Restore this version*. Props only: the
// container (EntryHistory.tsx) has the queries; /design renders it from the FigCraft text (src/design/fixtures/history.tsx).

export interface HistoryItem {
  /** The commit id, or `disk` for the file on disk that no commit has. */
  key: string;
  /** The commit message (*Add Panaracer table*), or *Not committed*. */
  title: string;
  /** *Dana · 5d ago*, with *current* or *deleted* after it. */
  sub: ReactNode;
  /** Who made it: the avatar's picture and first letter. Absent for the file on disk. */
  author?: { name: string; avatarUrl?: string };
  /** The version the entry shows now: it does not open. */
  current?: boolean;
  /** The commit deleted the file: there is nothing to open. */
  deleted?: boolean;
}

export interface HistorySheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The entry's title: the sheet's sub. */
  entryTitle: string;
  /** The versions; `undefined` while they load. */
  items: HistoryItem[] | undefined;
  /** A banner instead of the list (the list did not load). */
  error?: ReactNode;
  /** After the list: *Older versions on GitHub ↗*. */
  footer?: ReactNode;
  /** A version's row was pressed; `row` is that row's button, which the version sheet returns the focus to. */
  onOpenVersion(key: string, row?: HTMLElement): void;
  /** Where the focus goes when History closes (the ⋯ it was opened from). */
  finalFocus?: FinalFocus;
  /** The version sheet (`VersionSheet`), one level up. */
  children?: ReactNode;
}

const LOADING_ROWS = 4;

/** After a full list: the link to the versions GitHub shows beyond the newest ones (a 44 px target with the focus ring). */
export function OlderVersions({ href }: { href: string }) {
  return (
    <a
      className="inline-flex h-11 items-center gap-1 self-start rounded-xl px-1 text-base text-foreground underline underline-offset-2 outline-none focused:inset-ring-2 focused:inset-ring-ring"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      Older versions on GitHub <span aria-hidden="true">↗</span>
    </a>
  );
}

function Lead({ item }: { item: HistoryItem }) {
  if (!item.author) return <IconTile name="file" />;
  // FigCraft `list_row(lead_img=…)`: a 40 px picture with 12 px corners.
  return <Avatar name={item.author.name} src={item.author.avatarUrl} className="size-10 rounded-xl" />;
}

/** One version: a button that opens its diff, or a plain row for the current one and a deletion. */
function VersionRow({ item, onOpen }: { item: HistoryItem; onOpen(key: string, row: HTMLElement): void }) {
  const still = item.current || item.deleted;
  const body = (
    <>
      <Lead item={item} />
      <RowText title={item.title} sub={item.sub} />
      {still ? null : <RowChevron />}
    </>
  );
  if (still) return <div className={rowVariants({ size: 72 })}>{body}</div>;
  return (
    <button
      type="button"
      data-slot="row"
      aria-haspopup="dialog"
      className={rowVariants({ size: 72, pressable: true })}
      onClick={(e) => onOpen(item.key, e.currentTarget)}
    >
      {body}
    </button>
  );
}

/** *History*: a sheet over the entry with one card of versions. */
export function HistorySheet({
  open,
  onOpenChange,
  entryTitle,
  items,
  error,
  footer,
  onOpenVersion,
  finalFocus,
  children,
}: HistorySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="History" sub={entryTitle} finalFocus={finalFocus}>
      <div className="flex flex-col gap-4 px-4 pt-1 pb-8">
        {error ? (
          error
        ) : items === undefined ? (
          <Card aria-busy="true">
            {Array.from({ length: LOADING_ROWS }, (_, i) => (
              <div key={i} className={rowVariants({ size: 72 })}>
                <span aria-hidden="true" className="size-10 shrink-0 rounded-xl bg-muted" />
                <span className="flex flex-1 flex-col gap-2">
                  {i === 0 ? <span className="sr-only">Loading…</span> : null}
                  <span aria-hidden="true" className="h-3 w-45 rounded-full bg-muted" />
                  <span aria-hidden="true" className="h-2 w-28 rounded-full bg-muted" />
                </span>
              </div>
            ))}
          </Card>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 pt-12 pb-4 text-center">
            <IconTile name="clock" size={56} />
            <p className="m-0 text-lg font-semibold">No versions yet</p>
            <p className="m-0 text-base text-tray-muted-foreground">
              A version is a commit of this file. Commit the entry and it shows here.
            </p>
          </div>
        ) : (
          <Card as="ul" aria-label="Versions">
            {items.map((item) => (
              <li key={item.key}>
                <VersionRow item={item} onOpen={onOpenVersion} />
              </li>
            ))}
          </Card>
        )}
        {footer}
      </div>
      {children}
    </Sheet>
  );
}

export interface VersionSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** When: *5 days ago*. */
  title: string;
  /** The commit message and its author: *Add Panaracer table · Dana*. */
  sub?: string;
  /** The fields that differ, the version's value before and the entry's after; `undefined` while it loads. */
  rows: FieldDiffRow[] | undefined;
  /** The version did not load or does not parse: shown instead of the diff, and no CTA. */
  error?: ReactNode;
  /** The entry has unsaved edits: Restore replaces them. */
  replacesEdits?: boolean;
  onRestore(): void;
  /** Where the focus goes when it closes: the row that opened it, or nothing after Restore (History closes too). */
  finalFocus?: FinalFocus;
}

/** *History · version*: one version against the entry now, and *Restore this version*. */
export function VersionSheet({
  open,
  onOpenChange,
  title,
  sub,
  rows,
  error,
  replacesEdits,
  onRestore,
  finalFocus,
}: VersionSheetProps) {
  const restorable = !error && rows !== undefined && rows.length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      sub={sub}
      readOnly
      finalFocus={finalFocus}
      bar={
        restorable ? (
          <BottomBar>
            <Button variant="primary" size="lg" full onClick={onRestore}>
              Restore this version
            </Button>
          </BottomBar>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 px-4 pt-1 pb-8">
        {error ? (
          error
        ) : rows === undefined ? (
          <output className="block px-1 text-base text-tray-muted-foreground">Loading…</output>
        ) : rows.length === 0 ? (
          <p className="m-0 rounded-2xl bg-card p-4 text-base text-muted-foreground">
            Same as now: this version has the values the entry has.
          </p>
        ) : (
          <>
            <FieldDiffList rows={rows} />
            {replacesEdits ? (
              <p className="m-0 px-1 text-sm text-tray-muted-foreground">
                Restoring replaces the unsaved changes you made to this entry.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
