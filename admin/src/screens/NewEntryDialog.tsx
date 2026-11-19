import { useRef, useState, type RefObject } from 'react';

import { NewEntryView } from './NewEntryView';

import { isValidSlug, slugify } from '../../../core/paths';
import { collectionNames } from '../../../core/schema';
import { entryRefs, useFiles, type SchemaData } from '../data/queries';
import { pendingNewEntries } from '../entry/pending';
import { useRoute } from '../useRoute';

export type NewEntryDialogProps = {
  collection: string;
  schema: SchemaData;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Where the focus returns on close (opened from Search: what had it before Search). */
  finalFocus?: RefObject<HTMLElement | null>;
};

/**
 * A collection's label as a noun in a sentence (*New post*, *A tag with this address*): the first letter lower-cased
 * unless the label has a capital after it (*FAQ*, *Home Page*), which a label of names keeps. The schema's `label` is
 * the singular name of one entry (*Post*); the list heading reads `pluralLabel` (`collectionNames(def).many`).
 */
export function entryNoun(label: string): string {
  const rest = label.slice(1);
  return rest === rest.toLowerCase() ? label.slice(0, 1).toLowerCase() + rest : label;
}

/** The text around `{slug}` in the collection's `url` (`/posts/{slug}/` → `/posts/` and `/`), or none. */
export function slugAround(url: string | undefined): { before: string; after: string } | undefined {
  const at = url?.indexOf('{slug}') ?? -1;
  return url && at >= 0 ? { before: url.slice(0, at), after: url.slice(at + '{slug}'.length) } : undefined;
}

/** The field the name input fills: `slugFrom`, else `titleField`. */
function titleKey(schema: SchemaData, collection: string): string | undefined {
  const c = schema.schema.collections[collection];
  return c?.slugFrom ?? c?.titleField;
}

/**
 * *New post*: asks for the name first, the address (the slug) follows it until it is edited, then opens the blank entry,
 * unsaved. Nothing is written here; the entry's Save creates the file. The view is NewEntryView.tsx.
 */
export function NewEntryDialog({ collection, schema, open, onOpenChange, finalFocus }: NewEntryDialogProps) {
  const { navigate } = useRoute();
  const files = useFiles();
  const focus = useRef<HTMLInputElement>(null);
  const def = schema.schema.collections[collection];
  const label = def?.label ?? collection;
  const noun = entryNoun(label);
  const plural = def ? collectionNames(def).many : collection;
  const key = titleKey(schema, collection);
  const [name, setName] = useState('');
  const [typed, setTyped] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    // Each opening starts empty.
    setWasOpen(open);
    if (open) {
      setName('');
      setTyped(null);
      setEditing(false);
    }
  }
  const address = typed ?? slugify(name);

  const existing = new Set(files.data ? entryRefs(schema.schema, files.data, collection).map((r) => r.slug) : []);
  const problem =
    address === ''
      ? // A name with no Latin letters or digits (Привет мир, 日本語) makes no address: say so, and let the user write one.
        name.trim() === ''
        ? undefined
        : editing
          ? 'Write an address with lowercase letters, numbers and hyphens.'
          : 'This name makes no address (it needs letters a–z or numbers). Edit the address to write one.'
      : !isValidSlug(address)
        ? 'The address can use lowercase letters, numbers and hyphens.'
        : existing.has(address)
          ? `A ${noun} with this address already exists`
          : undefined;
  const canCreate = address !== '' && problem === undefined && files.data !== undefined;

  const create = () => {
    if (!canCreate) return;
    const initial: Record<string, unknown> = {};
    if (name.trim() !== '') {
      if (def?.titleField !== undefined) initial[def.titleField] = name;
      if (def?.slugFrom !== undefined) initial[def.slugFrom] = name;
    }
    pendingNewEntries.set(`${collection}/${address}`, initial);
    onOpenChange(false);
    navigate({ kind: 'entry', collection, slug: address });
  };

  return (
    <NewEntryView
      open={open}
      onOpenChange={onOpenChange}
      title={`New ${noun}`}
      sub={plural}
      nameLabel={key === undefined ? undefined : (def?.fields[key]?.label ?? 'Title')}
      name={name}
      onName={setName}
      address={address}
      onAddress={setTyped}
      around={slugAround(def?.url)}
      editing={editing}
      onEdit={() => setEditing(true)}
      problem={problem}
      ctaLabel={`Create ${noun}`}
      canCreate={canCreate}
      onCreate={create}
      focusRef={focus}
      finalFocus={finalFocus}
    />
  );
}
