import { cn } from './cn';

export type StatusBadgeProps = {
  /** `true` renders the Draft badge. `false` / absent renders nothing, unless `showPublished` asks for Published. */
  draft?: boolean;
  /** Also render a Published badge for a non-draft entry (list views, where an empty cell reads as missing data). */
  showPublished?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

/** Draft badge (the entry model only has a `draft` flag; copied from the old status chip). */
export function StatusBadge({ draft, showPublished, size = 'md', className }: StatusBadgeProps) {
  if (!draft && !showPublished) return null;
  const tone = draft ? 'draft' : 'published';
  return (
    <span
      className={cn(
        'editlet-chip editlet-chip--status',
        `editlet-chip--status-${size}`,
        `editlet-chip--${tone}`,
        className,
      )}
      title={draft ? 'Not live on the site' : 'Live on the site'}
    >
      <span className="editlet-chip__status-dot" />
      {draft ? 'Draft' : 'Published'}
    </span>
  );
}
