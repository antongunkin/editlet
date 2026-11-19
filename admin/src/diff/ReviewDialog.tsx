import { useEffect, useId, useState, type ReactNode } from 'react';

import { FieldDiffList, InfoRow } from './FieldDiff';

import type { FieldDiffRow } from '../entry/diff';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { BigTitle } from '../ui/parts/header';
import { Row } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { Badge } from '../ui/primitives/badge';
import { Button } from '../ui/primitives/button';
import { Textarea } from '../ui/primitives/input';

// Save changes (FigCraft *Your changes*, *Change · diff*, *Saving*, *Save to · new branch*, *Your changes · 600*): what
// a save puts in its one commit, before it is made. Props only: the entry screen passes its own diff; /design passes
// the design's two entries.

export interface ReviewEntry {
  /** The entry's ref (`post/tires`). */
  key: string;
  title: string;
  /** *Post · Title, Excerpt*: the collection and the changed fields. */
  sub: string;
  rows: FieldDiffRow[];
  /** *Revert this change* under the fields; `false` for a new entry (nothing to go back to). Default: `onRevert`'s. */
  revertable?: boolean;
  /** Why this entry blocks the save (*Changed elsewhere*, *The address is taken now*, *2 problems*): a badge on its row. */
  note?: string;
  /** The tone of `note` (default `danger`; *Changed elsewhere* is `unsaved`, the warning amber). */
  tone?: 'danger' | 'unsaved';
}

export type ReviewDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The entries with changes, each with its changed fields (`entryDiff`). */
  entries: ReviewEntry[];
  /** Repo paths of staged image files that go into the same commit. */
  newFiles: string[];
  /** Where the commit goes (*editlet/spring · PR #2*, *main · new branch*); nothing in dev mode (the files on disk). */
  saveTo?: string;
  /**
   * On the base branch: the new-branch field (`NewBranchField`). The CTA then opens *Save to*, where the name is chosen
   * and its own CTA saves.
   */
  newBranch?: ReactNode;
  /** Who must approve (`ApprovalNote`), under the list and in *Save to*. */
  note?: ReactNode;
  /** The CTA: *Save 2 changes*. */
  confirmLabel: string;
  busy?: boolean;
  /** Also disables the final save (no usable new-branch name yet, an offline dev server). */
  confirmDisabled?: boolean;
  onConfirm(): void;
  /** The diffs open inline under each entry (a 600 px window) instead of one level down. */
  inline?: boolean;
  /** /design: the entry whose diff is open, `save-to` or `note`. */
  initialOpen?: string;
  /**
   * *Revert this change* under each field of a diff: puts that field of that entry back to its saved value. Without
   * it the diffs only show.
   */
  onRevert?: (entryKey: string, row: FieldDiffRow) => void;
  /** The *Note* row (GitHub mode): the commit's optional body, edited in its own sheet. */
  commitNote?: { value: string; onChange(value: string): void };
  /** Under the diffs of an entry (and inline at 600 px): **Open entry**, which the caller answers by going there. */
  onOpenEntry?: (entryKey: string) => void;
  /** Under the diffs of an entry: **Discard changes to this entry**. */
  onDiscardEntry?: (entryKey: string) => void;
  /** The sheet header's ⋯ (*Discard all changes*): a node the caller draws, placed in the title row. */
  headerMenu?: ReactNode;
  /**
   * The CTA does not save (*Resolve 1 conflict*, *Fix 1 entry*): it calls `onConfirm` at once, with no *Save to* on the
   * base branch.
   */
  blocked?: boolean;
};

/** /design opens a second level once the first has risen (`sheet-motion`'s `modal-in`). */
const OPEN_AFTER_MS = 400;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** *2 entries, 3 fields* (and the new files, when there are any). */
export function reviewSummary(entries: ReviewEntry[], newFiles: string[]): string {
  const fields = entries.reduce((n, e) => n + e.rows.length, 0);
  const parts = [plural(entries.length, 'entry', 'entries'), plural(fields, 'field')];
  if (newFiles.length > 0) parts.push(plural(newFiles.length, 'new file'));
  return parts.join(', ');
}

/** The entry screen's one entry: *Post · Title, Excerpt*. */
export function reviewEntries(ref: string, title: string, collection: string, rows: FieldDiffRow[]): ReviewEntry[] {
  return [{ key: ref, title, sub: `${collection} · ${rows.map((r) => r.label).join(', ')}`, rows }];
}

/** The window is at least 600 px wide (the desktop window): the diffs show inline. */
const WIDE = '(min-width: 600px)';

export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(WIDE);
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * *Your changes*: the big title counts what the commit holds, each entry is a row (its diff one level down, or inline
 * at 600 px), the new image files and where the commit goes follow, and the one CTA saves. On the base branch the CTA
 * opens *Save to* first: the live site is never written, so the change goes to a new branch named there.
 */
export function ReviewDialog({
  open,
  onOpenChange,
  entries,
  newFiles,
  saveTo,
  newBranch,
  note,
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  inline = false,
  initialOpen,
  onRevert,
  commitNote,
  onOpenEntry,
  onDiscardEntry,
  headerMenu,
  blocked = false,
}: ReviewDialogProps) {
  const [opened, setOpened] = useState<string | null>(null);
  // A level opens after the one under it: opened together, the outer sheet's focus trap would mark the inner one inert.
  useEffect(() => {
    if (!initialOpen) return;
    const id = setTimeout(() => setOpened(initialOpen), OPEN_AFTER_MS);
    return () => clearTimeout(id);
  }, [initialOpen]);
  // Closed by the caller (the save landed): the next open starts at the list.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setOpened(null);
  }
  const formId = useId();
  const summary = reviewSummary(entries, newFiles);
  const empty = entries.length === 0 && newFiles.length === 0;
  const diffOf = entries.find((e) => e.key === opened);
  // The diff that is open lost its last change (every field reverted): back to the list.
  if (opened !== null && opened !== 'save-to' && opened !== 'note' && diffOf === undefined) setOpened(null);
  const revert = (key: string) => {
    const entry = entries.find((e) => e.key === key);
    return onRevert && entry?.revertable !== false ? (row: FieldDiffRow) => !busy && onRevert(key, row) : undefined;
  };
  /** Under an entry's diffs: Open entry, Discard changes to this entry. */
  const entryActions = (key: string) =>
    onOpenEntry || onDiscardEntry ? (
      <div className="flex flex-wrap gap-2 pt-1">
        {onOpenEntry ? (
          <Button variant="secondary" disabled={busy} onClick={() => onOpenEntry(key)}>
            Open entry
          </Button>
        ) : null}
        {onDiscardEntry ? (
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => onDiscardEntry(key)}>
            Discard changes to this entry
          </Button>
        ) : null}
      </div>
    ) : null;
  // The note's first line as the commit will have it (`withTrailer` drops a forged trailer line).
  const firstLine = commitNote?.value
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .find((l) => l !== '' && !/^editlet-source:/i.test(l));

  const save = () => (newBranch && !blocked ? setOpened('save-to') : onConfirm());

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpened(null);
        onOpenChange(next);
      }}
      title="Your changes"
      lead={headerMenu}
      // While it saves every control is locked: the content is only to read, and keeps a tab stop to scroll it.
      readOnly={inline || busy}
      bar={
        empty ? undefined : (
          <BottomBar>
            <Button
              variant="primary"
              size="lg"
              full
              loading={busy && (!newBranch || blocked)}
              busyLabel="Saving…"
              disabled={busy || ((!newBranch || blocked) && confirmDisabled)}
              onClick={save}
            >
              {confirmLabel}
            </Button>
          </BottomBar>
        )
      }
    >
      <BigTitle title={empty ? 'No changes' : summary} meta={empty ? undefined : 'One commit'} />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {entries.length > 0 ? (
          <Card as="ul" aria-label="Changed entries">
            {entries.map((entry) => {
              const count = entry.note ? (
                <Badge tone={entry.tone ?? 'danger'}>{entry.note}</Badge>
              ) : (
                <Badge tone="unsaved">{entry.rows.length}</Badge>
              );
              return (
                <li key={entry.key}>
                  {inline ? (
                    <>
                      <InfoRow lead="file" title={entry.title} sub={entry.sub} trail={count} />
                      <div className="pr-3 pb-3 pl-16">
                        <FieldDiffList rows={entry.rows} onRevert={revert(entry.key)} revertDisabled={busy} />
                        {entryActions(entry.key)}
                      </div>
                    </>
                  ) : (
                    <Row
                      lead="file"
                      title={entry.title}
                      sub={entry.sub}
                      trail={count}
                      disabled={busy}
                      aria-haspopup="dialog"
                      onClick={() => setOpened(entry.key)}
                    />
                  )}
                </li>
              );
            })}
          </Card>
        ) : null}
        {newFiles.length > 0 || saveTo || commitNote ? (
          <Card as="ul" aria-label="Commit">
            {newFiles.map((p) => (
              <InfoRow key={p} as="li" lead="image" title={fileName(p)} sub={`New file · ${p}`} />
            ))}
            {saveTo ? (
              <li>
                {newBranch ? (
                  <Row
                    lead="branch"
                    title="Save to"
                    sub={saveTo}
                    disabled={busy}
                    aria-haspopup="dialog"
                    onClick={() => setOpened('save-to')}
                  />
                ) : (
                  <InfoRow lead="branch" title="Save to" sub={saveTo} />
                )}
              </li>
            ) : null}
            {commitNote ? (
              <li>
                <Row
                  lead="pencil"
                  title="Note"
                  sub={firstLine || 'Add a note (optional)'}
                  disabled={busy}
                  aria-haspopup="dialog"
                  onClick={() => setOpened('note')}
                />
              </li>
            ) : null}
          </Card>
        ) : null}
        {note}
      </div>

      {inline ? null : (
        <Sheet
          open={diffOf !== undefined}
          onOpenChange={(next) => (next ? undefined : setOpened(null))}
          title={diffOf?.title ?? ''}
          sub={diffOf ? plural(diffOf.rows.length, 'change') : undefined}
          readOnly
        >
          <div className="px-4 pt-1 pb-8">
            {diffOf ? (
              <div className="flex flex-col gap-4">
                <FieldDiffList rows={diffOf.rows} onRevert={revert(diffOf.key)} revertDisabled={busy} />
                {entryActions(diffOf.key)}
              </div>
            ) : null}
          </div>
        </Sheet>
      )}

      {commitNote ? (
        <Sheet
          open={opened === 'note'}
          onOpenChange={(next) => (next ? undefined : setOpened(null))}
          title="Note"
          sub="Goes into the commit message"
          bar={
            <BottomBar>
              <Button variant="primary" size="lg" full onClick={() => setOpened(null)}>
                Done
              </Button>
            </BottomBar>
          }
        >
          <div className="px-4 pt-1 pb-8">
            <Textarea
              aria-label="Note"
              rows={4}
              value={commitNote.value}
              placeholder="What changed and why (optional)"
              onChange={(e) => commitNote.onChange(e.target.value)}
            />
          </div>
        </Sheet>
      ) : null}

      {newBranch ? (
        <Sheet
          open={opened === 'save-to'}
          onOpenChange={(next) => (next ? undefined : setOpened(null))}
          title="Save to"
          sub={summary}
          bar={
            <BottomBar>
              <Button
                type="submit"
                form={formId}
                variant="primary"
                size="lg"
                full
                loading={busy}
                busyLabel="Saving…"
                disabled={confirmDisabled}
              >
                Save to new branch
              </Button>
            </BottomBar>
          }
        >
          <form
            id={formId}
            className="flex flex-col gap-2 px-4 pt-1 pb-8"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && !confirmDisabled) onConfirm();
            }}
          >
            {newBranch}
            {note}
          </form>
        </Sheet>
      ) : null}
    </Sheet>
  );
}
