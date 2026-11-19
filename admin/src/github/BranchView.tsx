import { useId, type ReactNode } from 'react';

import type { FileDiff } from './branchDiff';

import type { BranchDiffOtherFile } from '../../../github';
import { DiffHunk } from '../diff/DiffHunk';
import { FieldDiffList, InfoRow } from '../diff/FieldDiff';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { BigTitle, Header } from '../ui/parts/header';
import { Sheet } from '../ui/parts/sheet';
import { Badge, type BadgeTone } from '../ui/primitives/badge';
import { IconTile } from '../ui/primitives/icon-tile';

// The branch screen as the design draws it (FigCraft *Publish · no pull request*, *· preview building*, *· preview
// failed*, *· reviewed*, *· branch missing*, *Other files*): the header with the branch, the big title, the publish
// steps as rows, a row for the other files and one for the changes, and the bottom bar with the status line and the one
// CTA. Props only: the container (BranchScreen.tsx) has the data, /design renders it from fixtures
// (src/design/fixtures/branch.tsx).

export interface BranchViewProps {
  /** The header's title: the branch (`editlet/spring`). */
  branch: string;
  back?: ReactNode;
  /** ⋯ (Edit on this branch), then the window's Move and Minimize. */
  actions?: ReactNode;
  /** The page's `h1`: *Review changes*, *Pull request #1*, *Branch not found*. */
  title: string;
  /** After the title: the pull request's Draft badge, *3 entries · PR #2*. */
  meta?: ReactNode;
  /** Under the title: errors, the labels notice, the branch that is gone. */
  banners?: ReactNode;
  /** The publish steps (`StepRow`s: Saved, Preview, Review, Live), each in an `li`. */
  steps?: ReactNode;
  /** The rows under the steps: *Other files this merge brings in*, *Changes*. */
  rows?: ReactNode;
  /** Under the rows: the other files, open (an Admin). */
  after?: ReactNode;
  status?: ReactNode;
  /** *Create pull request*, *Open pull request*, *Back to main*. */
  cta?: ReactNode;
  /** The screen's sheets (other files, changes) and the ⋯ action sheet. */
  children?: ReactNode;
}

export function BranchView({
  branch,
  back,
  actions,
  title,
  meta,
  banners,
  steps,
  rows,
  after,
  status,
  cta,
  children,
}: BranchViewProps) {
  return (
    // `branch-screen`: the demo's sandbox shim (src/sandbox/shim.ts) finds the Create pull request button under it.
    <section data-editlet="branch-screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header as="span" title={branch} back={back} actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <BigTitle as="h1" title={title} meta={meta} />
        {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
        {/* pb-8: the card's shadow reaches 28 px below it (ui4.content). */}
        <div className="flex flex-col gap-4 px-4 pb-8 empty:hidden">
          {steps ? (
            <Card as="ul" aria-label="Steps">
              {steps}
            </Card>
          ) : null}
          {rows ? <Card>{rows}</Card> : null}
          {after}
        </div>
      </div>
      <BottomBar status={status} className="shrink-0">
        {cta}
      </BottomBar>
      {children}
    </section>
  );
}

const STATUS: Record<BranchDiffOtherFile['status'], { label: string; tone: BadgeTone }> = {
  added: { label: 'Added', tone: 'success' },
  modified: { label: 'Modified', tone: 'unsaved' },
  removed: { label: 'Removed', tone: 'danger' },
  renamed: { label: 'Renamed', tone: 'review' },
};

/** A file's change in a word, on its state's tint. */
export function FileStatus({ status }: { status: BranchDiffOtherFile['status'] }) {
  const { label, tone } = STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** The other files' words and rows: why they are there, the 300-file note, one row per path with its change. */
function OtherFilesList({ files, complete }: { files: BranchDiffOtherFile[]; complete: boolean }) {
  return (
    <>
      <p className="m-0 px-1 text-sm text-tray-muted-foreground">Merging the pull request brings these in too.</p>
      {complete ? null : (
        <p className="m-0 px-1 text-sm text-tray-muted-foreground">GitHub listed only the first 300 files.</p>
      )}
      {files.length > 0 ? (
        <Card as="ul" aria-label="Other files">
          {files.map((f) => (
            <InfoRow
              key={f.path}
              as="li"
              lead="file"
              title={<span className="font-mono text-sm">{f.path}</span>}
              trail={<FileStatus status={f.status} />}
            />
          ))}
        </Card>
      ) : null}
    </>
  );
}

/**
 * *Other files* (FigCraft *Other files*): the code outside the CMS that merging the pull request brings in too, one row
 * per path with its change. `complete: false`: GitHub listed only the first 300 files. An Editor opens it from its row.
 */
export function OtherFilesSheet({
  open,
  onOpenChange,
  files,
  complete,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  files: BranchDiffOtherFile[];
  complete: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Other files" sub="This merge also changes code" readOnly>
      <div className="flex flex-col gap-2 px-4 pt-1 pb-8">
        <OtherFilesList files={files} complete={complete} />
      </div>
    </Sheet>
  );
}

/** The same list open on the screen, under its heading: an Admin sees the code a merge brings in at once (roles.md). */
export function OtherFilesSection({ files, complete }: { files: BranchDiffOtherFile[]; complete: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 px-1 text-base font-semibold">
        Other files this merge brings in
      </h2>
      <OtherFilesList files={files} complete={complete} />
    </section>
  );
}

const BINARY_VERB: Record<FileDiff['status'], string> = { added: 'added', modified: 'changed', removed: 'removed' };

/** One changed CMS file: its path and change, then the field diffs, a line diff, or what kind of file it is. */
function FileChange({ file }: { file: FileDiff }) {
  let body: ReactNode;
  if (file.kind === 'entry') {
    body =
      file.rows.length === 0 ? (
        <p className="m-0 px-1 text-sm text-tray-muted-foreground">No field changes</p>
      ) : (
        <FieldDiffList rows={file.rows} />
      );
  } else if (file.kind === 'text') {
    body = <DiffHunk before={file.before} after={file.after} showLineNumbers />;
  } else {
    body = (
      <p className="m-0 px-1 text-sm text-tray-muted-foreground">
        {file.image ? 'Image' : 'Binary file'} {BINARY_VERB[file.status]}
      </p>
    );
  }
  return (
    <section aria-label={file.path} className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile name={file.kind === 'binary' && file.image ? 'image' : 'file'} size={32} />
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{file.path}</code>
        <FileStatus status={file.status} />
      </div>
      {body}
    </section>
  );
}

/** *Changes*: every changed CMS file of the branch against the base, with its diff. */
export function ChangesSheet({
  open,
  onOpenChange,
  sub,
  files,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** *1 file · 1 field*. */
  sub: string;
  files: FileDiff[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Changes" sub={sub} readOnly>
      <div className="flex flex-col gap-6 px-4 pt-1 pb-8">
        {files.length === 0 ? (
          <p className="m-0 px-1 text-sm text-tray-muted-foreground">No content files changed.</p>
        ) : (
          files.map((file) => <FileChange key={file.path} file={file} />)
        )}
      </div>
    </Sheet>
  );
}

/**
 * A branch route the admin cannot show (FigCraft *Branch · dev mode*): the header, the branch icon on a 56 px tile, a
 * title and why. Dev mode has no branches; a name outside `<prefix>*` is not a CMS branch.
 */
export function BranchUnavailable({
  title,
  text,
  actions,
  banners,
  status,
}: {
  title: string;
  text: string;
  actions?: ReactNode;
  banners?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header title="Branch preview" actions={actions} className="shrink-0" />
      {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-4 pt-12 pb-4 text-center">
        <IconTile name="branch" size={56} />
        <h2 className="m-0 text-2xl font-semibold">{title}</h2>
        <p className="m-0 text-base text-tray-muted-foreground">{text}</p>
      </div>
      <BottomBar status={status} className="shrink-0" />
    </section>
  );
}
