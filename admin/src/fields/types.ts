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
  /** Repo path of the entry file being edited. */
  entryPath: string;
  /** Stage an uploaded file; resolves the src (relative to the entry) to store. Rejects with Error(message) on bad type/size. */
  stageUpload(file: File): Promise<string>;
  /** src → repo path (resolveAssetPath) or null. */
  resolveSrc(src: string): string | null;
  /** repo path → src relative to entry. */
  toSrc(repoPath: string): string;
  /** Renders an image preview for a repo path; `openable` adds a link that opens the image in a new window. */
  Preview(props: { path: string | null; alt: string; openable?: boolean }): ReactNode;
  /**
   * A field that projects its own text for select-to-edit (the markdown body) registers it under its name; `null`
   * removes it. Plain text inputs need nothing: their value is read from the form.
   */
  selectTarget?(name: string, target: SelectTarget | null): void;
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
