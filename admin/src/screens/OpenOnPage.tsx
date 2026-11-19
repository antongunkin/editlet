import type { Schema } from '../../../core/schema';
import { entryUrl } from '../../../core/urls';
import { ActionRow } from '../ui/parts/rows';
import { useBridge, usePagePath } from '../useRoute';

/** A pathname without its trailing `/` (the root stays `/`): `/posts/tires/` and `/posts/tires` are one page. */
const bare = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Why *Open on the page* is off (or what it should know): *Save first*, *This page*, *Draft*, or nothing. */
export function openOnPageNote(opts: { dirty: boolean; here: string | null; path: string; draft: boolean }) {
  if (opts.dirty) return { disabled: true, note: 'Save first' };
  if (opts.here !== null && bare(opts.here) === bare(opts.path)) return { disabled: true, note: 'This page' };
  return { disabled: false, note: opts.draft ? 'Draft' : undefined };
}

/**
 * ⋯ → *Open on the page*: the host page goes to the entry's URL (`entryUrl`), the editor stays on the entry. Only with
 * the collection's `url` and a site page around the admin. Off with *Save first* (unsaved edits, as Duplicate and
 * Rename…) and *This page* (already there, a trailing `/` ignored); a draft says *Draft* (its page may not exist on
 * the live site). Sends `open { path }`; the loader keeps the editor parameter (docs/admin/entry-form.md).
 */
export function OpenOnPageRow({
  schema,
  collection,
  slug,
  dirty,
  draft,
  onOpen,
}: {
  schema: Schema;
  collection: string;
  slug: string;
  dirty: boolean;
  draft: boolean;
  /** Closes the sheet; called before the message goes out. */
  onOpen(): void;
}) {
  const { status, send } = useBridge();
  const here = usePagePath();
  const path = entryUrl(schema, collection, slug);
  if (path === null || status !== 'connected') return null;
  const { disabled, note } = openOnPageNote({ dirty, here, path, draft });
  return (
    <ActionRow
      icon="arrow-up-right"
      disabled={disabled}
      note={note}
      onClick={() => {
        onOpen();
        send({ type: 'open', path });
      }}
    >
      Open on the page
    </ActionRow>
  );
}
