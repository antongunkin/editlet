// What the reference pickers of one entry form read (docs/admin/entry-form.md): nothing before a picker opens; then
// every title of a target under `LAZY_THRESHOLD` entries, and of a larger one the titles its pages show, until someone
// types in its search. One state per form, so the pickers share what was asked and none can loop the form.

import { useCallback, useMemo, useState } from 'react';

import { byTitle, entryRefs, useEntryOptions, useFiles, useSchema, type EntryOption } from './queries';

import type { FieldContext } from '../fields/types';
import { LAZY_THRESHOLD } from '../screens/collectionSort';
import { slugOf } from '../screens/listControls';

/** What the pickers asked for. Everything stays for the form's life. */
type Asked = {
  /** The collections of each opened picker, joined: the threshold is counted over them together. */
  pickers: ReadonlySet<string>;
  /** Collections someone typed a search over: every title. */
  searched: ReadonlySet<string>;
  /** The refs the pickers' pages have shown. */
  shown: ReadonlySet<string>;
};

const NOTHING: Asked = { pickers: new Set(), searched: new Set(), shown: new Set() };

const collectionOf = (ref: string) => ref.slice(0, ref.indexOf('/'));
/** Under the threshold an option whose title still loads shows its slug as its title. */
const slugged = (o: EntryOption) => (o.title === null ? { ref: o.ref, title: slugOf(o.ref) } : o);

/** The picker's part of the form's `FieldContext`. */
export type PickerContext = Pick<
  FieldContext,
  'entries' | 'wantEntries' | 'wantTitles' | 'titlesProgress' | 'entriesPending'
>;

/**
 * The reference pickers of a form over `targets` (its reference fields' collections). `chosen` are the titles of the
 * entries the form's values name (`useEntryTitles`): those entries are offered under them, opened picker or not.
 * `options` are the entries of the collections a picker opened.
 */
export function useFormOptions(
  targets: string[],
  chosen: ReadonlyMap<string, string>,
): { options: EntryOption[]; picker: PickerContext } {
  const files = useFiles().data;
  const schema = useSchema().data?.schema;
  const [asked, setAsked] = useState(NOTHING);
  // Asking for what was asked already keeps the state.
  const ask = useCallback((part: keyof Asked, values: readonly string[]) => {
    setAsked((prev) =>
      values.every((v) => prev[part].has(v)) ? prev : { ...prev, [part]: new Set([...prev[part], ...values]) },
    );
  }, []);
  const wantEntries = useCallback((collections: string[]) => ask('pickers', [collections.join('\0')]), [ask]);
  const wantTitles = useCallback(
    (collections: string[], refs: string[] | 'all') =>
      refs === 'all' ? ask('searched', collections) : ask('shown', refs),
    [ask],
  );

  const pickers = useMemo(() => [...asked.pickers].map((p) => p.split('\0')), [asked.pickers]);
  const wanted = targets.filter((c) => pickers.some((collections) => collections.includes(c)));
  // `small`: every entry of the pickers under the threshold. `whole`: those, and every entry of a searched collection.
  const { small, whole } = useMemo(() => {
    const listed = (c: string) => (schema && files ? entryRefs(schema, files, c).map((ref) => `${c}/${ref.slug}`) : []);
    const under = pickers.flatMap((collections) => {
      const refs = collections.flatMap(listed);
      return refs.length < LAZY_THRESHOLD ? refs : [];
    });
    return { small: new Set(under), whole: [...under, ...[...asked.searched].flatMap(listed)] };
  }, [schema, files, pickers, asked.searched]);
  const want = useMemo(() => new Set([...whole, ...asked.shown]), [whole, asked.shown]);
  const { options } = useEntryOptions(wanted, want);

  const listing = files === undefined;
  const picker = useMemo((): PickerContext => {
    // The options, and the chosen entries of a collection no picker opened. A chosen entry has `chosen`'s title.
    const refs = new Set(options.map((o) => o.ref));
    const offered = [
      ...options.map((o) => {
        const title = chosen.get(o.ref);
        return title === undefined ? o : { ref: o.ref, title };
      }),
      ...[...chosen].filter(([ref]) => !refs.has(ref)).map(([ref, title]) => ({ ref, title })),
    ];
    const of = (list: EntryOption[], collections: string[]) =>
      list.filter((o) => collections.includes(collectionOf(o.ref)));
    return {
      entries(collections) {
        const mine = of(offered, collections);
        if (mine.length < LAZY_THRESHOLD) return mine.map(slugged).toSorted(byTitle(targets));
        // By collection in the field's order. They are by slug within one already, and the sort keeps that.
        const rank = (o: EntryOption) => collections.indexOf(collectionOf(o.ref));
        return collections.length > 1 ? mine.toSorted((a, b) => rank(a) - rank(b)) : mine;
      },
      wantEntries,
      wantTitles,
      titlesProgress(collections) {
        if (!collections.every((c) => asked.searched.has(c))) return undefined;
        const mine = of(options, collections);
        if (mine.length < LAZY_THRESHOLD) return undefined;
        return { loaded: mine.filter((o) => o.title !== null).length, total: mine.length };
      },
      entriesPending: listing || options.some((o) => o.title === null && small.has(o.ref)),
    };
  }, [options, chosen, targets, wantEntries, wantTitles, asked.searched, listing, small]);

  return { options, picker };
}
