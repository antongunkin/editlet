import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type MutableRefObject } from 'react';

import { EntryEditorFrame, useEntryEditor } from './EntryEditor';
import { EntryLoader, type LoadedEntry } from './EntryLoader';
import { FieldRows } from './FieldRows';

import { fieldGroups } from '../../../core/schema';
import { invalidateFiles } from '../data/queries';
import { groupOf } from '../entry/groups';
import { RouteLink } from '../RouteLink';
import { Banner, Button, buttonVariants, cn, Icon } from '../ui';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { Sheet } from '../ui/parts/sheet';

/**
 * How many entry sheets are open: the entry screen pauses select-to-edit while one is (a selection would close the
 * picker and unmount the entry on top). Provided by the screen.
 */
export const OnTopContext = createContext<MutableRefObject<number> | null>(null);

/** How long the sheet stays mounted after it closes: it finishes its exit animation. */
const UNMOUNT_AFTER_MS = 600;

/**
 * A referenced entry edited on top of the reference picker (FigCraft *Author · edit on top*): its fields as the entry
 * screen has them, in a sheet one level over the picker. The edits go to the changes buffer like any entry's (its form
 * writes its row), so **Done**, a swipe, the scrim, × and Escape all keep them; the entry under it shows them in its
 * status line, and *Your changes* saves both entries in one commit. Mounted only while open (and a moment after), so
 * opening it again reads the buffered row back.
 */
export function EntrySheet({
  entryRef,
  open,
  onOpenChange,
}: {
  entryRef: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), UNMOUNT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);
  const count = useContext(OnTopContext);
  useEffect(() => {
    if (!mounted || !count) return;
    count.current += 1;
    return () => {
      count.current -= 1;
    };
  }, [mounted, count]);
  if (!mounted) return null;
  const slash = entryRef.indexOf('/');
  const collection = entryRef.slice(0, slash);
  const slug = entryRef.slice(slash + 1);
  return (
    <EntryLoader
      collection={collection}
      slug={slug}
      renderFallback={({ def, error }) => (
        <LoadingSheet title={slug} sub={def?.label} error={error} open={open} onOpenChange={onOpenChange} />
      )}
    >
      {(entry) => <EntrySheetBody entry={entry} open={open} onOpenChange={onOpenChange} />}
    </EntryLoader>
  );
}

/** While the entry loads, or when it failed to: the sheet with placeholder rows, or the error with *Try again*. */
function LoadingSheet({
  title,
  sub,
  error,
  open,
  onOpenChange,
}: {
  title: string;
  sub?: string;
  error: Error | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const client = useQueryClient();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} sub={sub}>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
        {error ? (
          <Banner
            tone="danger"
            role="alert"
            action={
              <Button size="md" onClick={() => void invalidateFiles(client)}>
                Try again
              </Button>
            }
          >
            {error.message}
          </Banner>
        ) : (
          <p className="m-0 px-1 text-base text-muted-foreground">Loading…</p>
        )}
      </div>
    </Sheet>
  );
}

function EntrySheetBody({
  entry,
  open,
  onOpenChange,
}: {
  entry: LoadedEntry;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { def, collection, slug } = entry;
  const ref = `${collection}/${slug}`;
  // One entry on top: no `EntrySheet` in its context (its pickers keep *Open ›*), no select-to-edit targets, ids prefixed.
  // The buffer is its only way out: no handle for *Your changes* (the screen's form is that), no Save of its own.
  const editor = useEntryEditor({ entry, prefix: `on-top:${ref}:`, registerHandle: false });
  const [openField, setOpenField] = useState<string | null>(null);
  const groups = fieldGroups(def);
  const tabbed = groups.length > 1;
  return (
    <EntryEditorFrame editor={editor}>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={editor.entryTitle}
        sub={`${def.label}${editor.dirty ? ' · Unsaved' : ''}`}
        bar={
          <BottomBar>
            <Button variant="primary" size="lg" full onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </BottomBar>
        }
      >
        <div className="flex flex-col gap-4 px-4 pt-1 pb-8">
          {entry.notices}
          {editor.issueBanners}
          {groups.map((group) => {
            const items = editor.items.filter((i) => groupOf(groups, i.key) === group.key);
            if (items.length === 0) return null;
            return (
              <section key={group.key} className="flex flex-col gap-2" aria-label={tabbed ? group.label : undefined}>
                {tabbed ? (
                  <h3 className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">{group.label}</h3>
                ) : null}
                <Card as="fieldset" aria-label={`${ref} fields`}>
                  <FieldRows
                    items={items}
                    ctx={editor.ctx}
                    sub={editor.entryTitle}
                    open={openField}
                    onOpen={setOpenField}
                    title={editor.titleOf}
                  />
                </Card>
              </section>
            );
          })}
          <RouteLink to={ref} className={cn(buttonVariants({ variant: 'ghost' }), 'self-center no-underline')}>
            Go to {editor.entryTitle}
            <Icon name="chevron-right" size={16} />
          </RouteLink>
        </div>
        {editor.dialogs}
      </Sheet>
    </EntryEditorFrame>
  );
}
