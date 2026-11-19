import { Badge } from './primitives/badge';

export type StatusBadgeProps = {
  /** `true` renders the Draft badge. `false` / absent renders nothing, unless `showPublished` asks for Published. */
  draft?: boolean;
  /** Also render a Published badge for a non-draft entry (list views, where an empty cell reads as missing data). */
  showPublished?: boolean;
  className?: string;
};

/** The entry's status as a badge (the entry model only has a `draft` flag): Draft is neutral, Published green. */
export function StatusBadge({ draft, showPublished, className }: StatusBadgeProps) {
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
