import { Badge } from './primitives/badge';

import { fileStatusLabel, type FileStatus } from '../status/labels';

export type StatusBadgeProps = {
  /** `true` renders the Draft badge. `false` / absent renders nothing, unless `showPublished` asks for Published. */
  draft?: boolean;
  /** Also render a Published badge for a non-draft entry (list views, where an empty cell reads as missing data). */
  showPublished?: boolean;
  /**
   * The file's status (`useFileStatuses().of(path)`): when set it wins over Draft / Published. *Unsaved* and *Changed*
   * in the unsaved tone, *In review* in the review tone (FigCraft *Posts*).
   */
  status?: FileStatus | null;
  className?: string;
};

const STATUS_TITLE: Record<FileStatus, string> = {
  unsaved: 'Edited in this browser, not saved yet',
  review: 'In an open pull request',
  changed: 'Saved, not live on the site yet',
};

/**
 * The entry's status as a badge: its file status first (*Unsaved*, *In review*, *Changed*), else the entry's `draft`
 * flag: Draft is neutral, Published green.
 */
export function StatusBadge({ draft, showPublished, status, className }: StatusBadgeProps) {
  if (status) {
    return (
      <Badge tone={status === 'review' ? 'review' : 'unsaved'} className={className} title={STATUS_TITLE[status]}>
        {fileStatusLabel(status)}
      </Badge>
    );
  }
  if (!draft && !showPublished) return null;
  return (
    <Badge
      tone={draft ? 'neutral' : 'success'}
      dot
      className={className}
      title={draft ? 'Not live on the site' : 'Live on the site'}
    >
      {draft ? 'Draft' : 'Published'}
    </Badge>
  );
}
