import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';

import type { Field } from '../../../core/schema';
import type { SelectTarget } from '../select/useApplySelect';

export interface FieldContext {
  /**
   * Entries of the given collections, for reference pickers: all of a wanted collection (`wantEntries`), else only the
   * ones the form's own values name. Under 200 of them (`LAZY_THRESHOLD`) they sort by title, which is the slug while it
   * loads; from 200 by collection then slug, and `title` is `null` until it is read (`wantTitles`).
   */
  entries(collections: string[]): { ref: string; title: string | null }[];
  /**
   * A picker over these collections opened: their entries are listed now, and stay for the form's life. Under 200 of
   * them every title is read too. Safe to call again; the same function for the form's life.
   */
  wantEntries(collections: string[]): void;
  /**
   * The titles a picker over 200 entries or more needs: of the refs its page shows, or of every one (`'all'`) once
   * someone types in its search, which is not taken back. Safe to call again; the same function for the form's life.
   */
  wantTitles?(collections: string[], refs: string[] | 'all'): void;
  /**
   * Over 200 entries or more, once every title was asked for: how many are there. Reference widgets show the loading
   * line and keep *No entries match* back while `loaded < total`. Undefined otherwise.
   */
  titlesProgress?(collections: string[]): { loaded: number; total: number } | undefined;
  /**
   * True while the file list loads, or the titles of a wanted target under 200 entries: reference widgets do not call
   * unlisted values missing then.
   */
  entriesPending?: boolean;
  /** A link that opens the entry `to` (`collection/slug`) in the admin; without it reference widgets show no link. */
  EntryLink?(props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }): ReactNode;
  /** Repo paths of image files under contentDir. */
  images: string[];
  /** The content folder (`cms/content`), to show an image's folder without it. */
  contentDir?: string;
  /** Repo path of the entry file being edited. */
  entryPath: string;
  /** Stage an uploaded file; resolves the src (relative to the entry) to store. Rejects with Error(message) on bad type/size. */
  stageUpload(file: File): Promise<string>;
  /** src → repo path (resolveAssetPath) or null. */
  resolveSrc(src: string): string | null;
  /** True while the file at this repo path is staged (uploaded in this form, not saved yet). */
  isStaged?(repoPath: string): boolean;
  /** repo path → src relative to entry. */
  toSrc(repoPath: string): string;
  /**
   * Renders an image preview for a repo path; `openable` adds a link that opens the image in a new window, `className`
   * replaces its size and fit.
   */
  Preview(props: { path: string | null; alt: string; openable?: boolean; className?: string }): ReactNode;
  /**
   * A field that projects its own text for select-to-edit (the markdown body) registers it under its name; `null`
   * removes it. Plain text inputs need nothing: their value is read from the form.
   */
  selectTarget?(name: string, target: SelectTarget | null): void;
  /**
   * The entry sheet (`screens/EntrySheet.tsx`): *Edit <title>* in a reference's picker opens the chosen entry on top of
   * it. Unset inside an entry sheet (one entry on top, never two) and inside objects and blocks (their pickers keep
   * *Open <title> ›*).
   */
  EntrySheet?: ComponentType<{ entryRef: string; open: boolean; onOpenChange(open: boolean): void }>;
  /** The ref of the entry whose fields these are (`collection/slug`): *Edit* is not offered for the entry itself. */
  selfRef?: string;
  /** The mode a body opens in, instead of the one saved in `localStorage` (/design: *Edit · Body · Source*). */
  markdownMode?: 'rich' | 'source';
}

export interface WidgetProps<V> {
  name: string;
  field: Field;
  value: V;
  onChange(v: V): void;
  onBlur?(): void;
  error?: string[];
  ctx: FieldContext;
}

/** UI value of an `image` field. */
export interface ImageValue {
  src: string;
  alt: string;
}
