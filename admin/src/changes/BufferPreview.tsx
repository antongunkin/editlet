import { useEffect } from 'react';

import { useBuffer } from './trayContext';

import { useSchema } from '../data/queries';
import { mimeType } from '../data/useAssetUrl';
import { usePreview } from '../preview/PreviewProvider';
import { fieldPreviews } from '../preview/snapshot';
import { useSource } from '../source/context';

/**
 * The page shows the unsaved edits of **every** buffered entry while the admin is open (a page built from a post and
 * its author shows both), not only the open form's: `setBufferPreview` between the branch layer and the open forms.
 * Images come from the buffer's image rows, else the source. Renders nothing.
 */
export function BufferPreview() {
  const { entries, images } = useBuffer();
  const schema = useSchema().data?.schema;
  const source = useSource();
  const { setBufferPreview } = usePreview();

  useEffect(() => {
    if (!schema) return;
    let cancelled = false;
    const staged = new Map(
      images.flatMap((r) => (r.content instanceof Uint8Array ? [[r.path, r.content] as const] : [])),
    );
    const readImage = async (path: string): Promise<Blob | null> => {
      let bytes = staged.get(path);
      if (!bytes) {
        try {
          bytes = await source.readFile(path);
        } catch {
          return null;
        }
      }
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType(path) });
    };
    void Promise.all(
      entries.flatMap((e) =>
        e.after && e.blocked !== 'newer-admin'
          ? [
              fieldPreviews(schema, e.collection, e.path, e.before, e.after, readImage).then(
                (fields) => [e.ref, fields] as const,
                () => null,
              ),
            ]
          : [],
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setBufferPreview(Object.fromEntries(pairs.filter((p) => p !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [entries, images, schema, source, setBufferPreview]);

  // Leaving the shell (a branch switch, sign-out): the layer goes with it.
  useEffect(() => () => setBufferPreview(null), [setBufferPreview]);
  return null;
}
