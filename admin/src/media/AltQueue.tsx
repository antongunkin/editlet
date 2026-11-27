import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { AltQueueView } from './AltQueueView';
import { entryEdits } from './edits';
import { blankUses, entriesOf, loadMediaIndex, readEntryFiles, type MediaImage, type MediaUse } from './mediaIndex';
import { useMediaCommit } from './useMediaCommit';

import { entriesSubject } from '../../../core/gitStyle';
import type { Schema } from '../../../core/schema';
import { AssetPreview } from '../data/useAssetUrl';
import { useWorkspace } from '../github/workspace';
import { useSiteRefresh } from '../preview/PreviewProvider';
import { useSource } from '../source/context';

/** How many uses without alt text the queue lists by name; the rest is *+N more places*. */
const USES_SHOWN = 2;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** *Post · Cover · Tires for a rigid bike*: where a use is (the collection, the field, the entry). */
function placeLine(schema: Schema, use: MediaUse): string {
  const collection = schema.collections[use.collection];
  const field = use.label ?? collection?.fields[use.field]?.label ?? 'Body';
  return [collection?.label ?? use.collection, field, use.title].join(' · ');
}

export interface AltQueueProps {
  schema: Schema;
  /** The images to walk, in order: taken once when the queue opens and kept (the grid's own list shrinks). */
  images: MediaImage[];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** *Open image ›*: the image's own page (`MediaDetail`), for different texts per use. Ends the queue. */
  onOpenImage(path: string): void;
}

/** Where the walk stands: the counts so far, and the images skipped in this pass (a second pass walks them again). */
type Tally = { saved: number; already: number; skipped: MediaImage[] };

/**
 * The missing alt queue (FigCraft *Media · alt queue*): a sheet over Media that walks the images without alt text one
 * at a time: the picture, where it is used, one **Alt text** field, **Save & next**, **Skip** and the progress
 * (docs/admin/media.md#the-missing-alt-queue). One commit per image through its own `useMediaCommit` (so the new-branch
 * question on the base branch opens as a second level inside this sheet, once), and one refresh of the site when the
 * queue closes. Every save reads a fresh index: after one commit an entry's sha has moved, so the uses captured when
 * the queue opened are stale.
 */
export function AltQueue({ schema, images, open, onOpenChange, onOpenImage }: AltQueueProps) {
  const client = useQueryClient();
  const source = useSource();
  const cache = useWorkspace()?.source.cache ?? null;
  const refreshSite = useSiteRefresh();
  const commit = useMediaCommit();
  const [order, setOrder] = useState<MediaImage[]>(images);
  const [pos, setPos] = useState(0);
  const [alt, setAlt] = useState('');
  const [tally, setTally] = useState<Tally>({ saved: 0, already: 0, skipped: [] });
  const [finished, setFinished] = useState(images.length === 0);
  const [checking, setChecking] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const field = useId();
  const hint = useId();
  // A commit's `onDone` can come after the sheet was closed: the refresh then follows it.
  const openRef = useRef(open);
  openRef.current = open;
  const unrefreshed = useRef(false);

  const image = order[pos];
  const busy = commit.busy || checking;
  const error = readError ?? commit.error;

  const refresh = () => {
    if (!unrefreshed.current) return;
    unrefreshed.current = false;
    void refreshSite();
  };
  const close = (next: boolean) => {
    // Not while a commit runs: its outcome (the refresh, a failure's banner) belongs to this sheet.
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) refresh();
  };

  // After each image the field is empty and focused again (a click on the bar took the focus).
  useEffect(() => {
    if (open && image && !finished) input.current?.focus();
  }, [open, image, finished]);

  /** Moves on after an image was saved, skipped or found done: the next one, or the end. */
  const advance = (now: Tally, said: string) => {
    const next = order[pos + 1];
    setAlt('');
    setReadError(null);
    commit.clearError();
    setTally(now);
    if (next) {
      setPos(pos + 1);
      setAnnouncement(`${said} ${pos + 2} of ${order.length}: ${next.name}`);
    } else {
      setFinished(true);
      setAnnouncement(`${said} All done.`);
    }
  };

  const save = async () => {
    const text = alt.trim();
    if (!image || text === '' || busy) return;
    setChecking(true);
    setReadError(null);
    try {
      // Fixed elsewhere meanwhile? Then there is nothing to commit (and on the base branch, no branch to create).
      const fresh = await loadMediaIndex(client, source, schema, cache);
      const uses = blankUses(fresh.images.find((i) => i.path === image.path));
      if (uses.length === 0) return advance({ ...tally, already: tally.already + 1 }, 'Already has alt text.');
      commit.request({
        message: `Update alt text of ${image.name}`,
        subject: entriesSubject('update', [
          ...new Map(uses.map((use) => [use.entryPath, { collection: use.collection, slug: use.slug }])).values(),
        ]),
        refresh: false,
        build: async () => {
          // Read again: a commit can land between the check and this one.
          const again = await loadMediaIndex(client, source, schema, cache);
          const blank = blankUses(again.images.find((i) => i.path === image.path));
          const files = await readEntryFiles(client, source, entriesOf(again, blank));
          return [
            entryEdits(
              schema,
              again,
              blank.map((use) => ({ use, alt: text })),
              files,
            ),
          ];
        },
        onDone: () => {
          unrefreshed.current = true;
          advance({ ...tally, saved: tally.saved + 1 }, 'Saved.');
          if (!openRef.current) refresh();
        },
      });
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const skip = () => {
    if (image && !busy) advance({ ...tally, skipped: [...tally.skipped, image] }, 'Skipped.');
  };

  /** *Go through N skipped*: the queue again, with only those. */
  const again = () => {
    const list = tally.skipped;
    setOrder(list);
    setPos(0);
    setTally({ ...tally, skipped: [] });
    setFinished(false);
    setAnnouncement(
      `${count(list.length, 'image', 'images')} to go through again. 1 of ${list.length}: ${list[0]!.name}`,
    );
  };

  const uses = image ? blankUses(image) : [];

  return (
    <AltQueueView
      open={open}
      onOpenChange={close}
      image={
        finished || !image
          ? null
          : {
              name: image.name,
              picture: <AssetPreview path={image.path} alt="" className="block size-14 rounded-xl object-cover" />,
              uses: uses.slice(0, USES_SHOWN).map((use) => placeLine(schema, use)),
              moreUses: Math.max(uses.length - USES_SHOWN, 0),
            }
      }
      position={pos + 1}
      total={order.length}
      summary={{ saved: tally.saved, skipped: tally.skipped.length, already: tally.already }}
      alt={alt}
      onAlt={setAlt}
      inputRef={input}
      fieldId={field}
      hintId={hint}
      onSave={() => void save()}
      onSkip={skip}
      // No refresh on Open image: on Astro it reloads the page and the image's page with it. The next save refreshes.
      onOpenImage={() => image && onOpenImage(image.path)}
      onAgain={again}
      onDone={() => close(false)}
      busy={busy}
      error={error}
      announcement={announcement}
    >
      {commit.dialog}
    </AltQueueView>
  );
}
