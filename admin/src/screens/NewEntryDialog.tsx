import { useId, useState } from 'react';

import { isValidSlug, slugify } from '../../../core/paths';
import { entryRefs, useFiles, type SchemaData } from '../data/queries';
import { pendingNewEntries } from '../entry/pending';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Field, fieldDescribedBy } from '../ui/Field';
import { FIELD_INPUT_CLASS } from '../ui/Input';
import { useRoute } from '../useRoute';

export type NewEntryDialogProps = {
  collection: string;
  schema: SchemaData;
  open: boolean;
  onOpenChange(open: boolean): void;
};

/** The field the title input fills: `slugFrom`, else `titleField`. */
function titleKey(schema: SchemaData, collection: string): string | undefined {
  const c = schema.schema.collections[collection];
  return c?.slugFrom ?? c?.titleField;
}

function NewEntryForm({ collection, schema, onOpenChange }: Omit<NewEntryDialogProps, 'open'>) {
  const id = useId();
  const { navigate } = useRoute();
  const files = useFiles();
  const key = titleKey(schema, collection);
  const def = schema.schema.collections[collection];
  const [title, setTitle] = useState('');
  const [slugInput, setSlugInput] = useState<string | null>(null);
  const slug = slugInput ?? slugify(title);

  const existing = new Set(files.data ? entryRefs(schema.schema, files.data, collection).map((r) => r.slug) : []);
  const error =
    slug === ''
      ? undefined
      : !isValidSlug(slug)
        ? 'Invalid slug'
        : existing.has(slug)
          ? 'Slug already exists'
          : undefined;
  const canConfirm = slug !== '' && error === undefined && files.data !== undefined;

  const confirm = () => {
    if (!canConfirm) return;
    const initial: Record<string, unknown> = {};
    if (title.trim() !== '') {
      if (def?.titleField !== undefined) initial[def.titleField] = title;
      if (def?.slugFrom !== undefined) initial[def.slugFrom] = title;
    }
    pendingNewEntries.set(`${collection}/${slug}`, initial);
    onOpenChange(false);
    navigate({ kind: 'entry', collection, slug });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        confirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>New {def?.label ?? collection}</DialogTitle>
        <DialogDescription>Nothing is saved until you save the entry.</DialogDescription>
      </DialogHeader>
      <div className="editlet-u-stack editlet-u-gap-3">
        {key !== undefined ? (
          <Field label={def?.fields[key]?.label ?? 'Title'} htmlFor={`${id}-title`}>
            <input
              id={`${id}-title`}
              className={FIELD_INPUT_CLASS}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- first field of a modal dialog
              autoFocus
            />
          </Field>
        ) : null}
        <Field label="Slug" htmlFor={`${id}-slug`} error={error}>
          <input
            id={`${id}-slug`}
            className={FIELD_INPUT_CLASS}
            value={slug}
            onChange={(e) => setSlugInput(e.target.value)}
            spellCheck={false}
            aria-invalid={error !== undefined ? true : undefined}
            aria-describedby={fieldDescribedBy(`${id}-slug`, undefined, error)}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canConfirm}>
          Confirm
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Asks for a slug (auto-filled from the title until edited), then opens the new, unsaved entry. */
export function NewEntryDialog({ open, onOpenChange, ...props }: NewEntryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <NewEntryForm {...props} onOpenChange={onOpenChange} /> : null}</DialogContent>
    </Dialog>
  );
}
