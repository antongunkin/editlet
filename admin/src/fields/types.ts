import type { AnchorHTMLAttributes, ReactNode } from 'react';

import type { Field } from '../../../core/schema';
import type { SelectTarget } from '../select/useApplySelect';

export interface FieldContext {
  /** Entries of the given collections, for reference pickers. */
  entries(collections: string[]): { ref: string; title: string }[];
  /** True while the entry list is not loaded yet: reference widgets do not call unlisted values missing then. */
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
