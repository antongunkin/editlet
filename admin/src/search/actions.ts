// The search's actions (docs/admin/search.md#actions): what the sheet can start besides opening an entry. Pure: built
// from what the admin already has (the schema, the file list, the route, the theme choice) and the open screen's own
// actions (`useSearchActions`).

import { rank, rankText, type SearchEntry } from './match';

import type { Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';
import { entryRefs } from '../data/queries';
import { formatRoute, type Route } from '../route';
import { entryNoun } from '../screens/NewEntryDialog';
import type { IconName } from '../ui/primitives/icons';
import type { ThemeChoice } from '../window/settings';

/** What an action does when it runs; `SearchProvider` carries it out. */
export type ActionRun =
  | { kind: 'navigate'; to: Route }
  | { kind: 'new'; collection: string }
  | { kind: 'switch-branch' }
  | { kind: 'theme'; choice: ThemeChoice }
  /** A screen's own action (Duplicate): its callback. */
  | { kind: 'call'; call: () => void };

export interface SearchAction {
  id: string;
  label: string;
  /** The muted second line. */
  sub?: string;
  icon: IconName;
  /** Words it also answers to, besides its label. */
  keywords: readonly string[];
  /** Shown off: listed and walked by the keyboard (`aria-disabled`), Enter does nothing. */
  disabled?: boolean;
  /** Why it is off, in place of `sub` (*Save first*). */
  note?: string;
  /** Listed under an empty field (the screen's context actions). */
  context: boolean;
  run: ActionRun;
}

/** What a screen offers the search while it is open (the entry's *Duplicate this entry*). */
export interface ScreenAction {
  id: string;
  label: string;
  sub?: string;
  icon: IconName;
  keywords: readonly string[];
  disabled?: boolean;
  note?: string;
  run: () => void;
}

export interface ActionInput {
  schema: Schema;
  /** The file list, for the entry counts of the collection rows; `undefined` while it loads. */
  files: FileRef[] | undefined;
  /** The active branch in GitHub mode (*Switch branch…*); `null` on the local source. */
  branch: string | null;
  route: Route;
  theme: ThemeChoice;
  screenActions: readonly ScreenAction[];
}

/** The most actions a typed query lists, and under an empty field. */
export const ACTION_LIMIT = 5;
export const CONTEXT_LIMIT = 4;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const THEMES: { choice: ThemeChoice; label: string; icon: IconName }[] = [
  { choice: 'dark', label: 'Use dark appearance', icon: 'moon' },
  { choice: 'light', label: 'Use light appearance', icon: 'palette' },
  { choice: 'system', label: 'Use system appearance', icon: 'palette' },
];

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/**
 * Every action for this screen, in the order a tie keeps: the screen's own (Duplicate), the places (*Go to*),
 * *New <noun>* per collection, *Switch branch…*, the two other Appearance choices. Context actions (`context: true`) are, in
 * that order, Duplicate, the screen's collection's *New*, *Switch branch…* on Home.
 */
export function buildActions({ schema, files, branch, route, theme, screenActions }: ActionInput): SearchAction[] {
  const here = formatRoute(route);
  const screenCollection = route.kind === 'collection' || route.kind === 'entry' ? route.collection : null;
  const collections = Object.entries(schema.collections);
  const out: SearchAction[] = screenActions.map(({ run, ...action }) => ({
    ...action,
    context: true,
    run: { kind: 'call', call: run },
  }));

  // The places, named as All content names them; the screen already open is no place to go.
  const places: SearchAction[] = collections.map(([key, def]) => {
    const count = files ? entryRefs(schema, files, key).length : undefined;
    return {
      id: `go:${key}`,
      label: def.label,
      sub: def.singleton
        ? 'Single page'
        : count === undefined
          ? 'Collection'
          : `Collection · ${plural(count, 'entry', 'entries')}`,
      icon: def.singleton ? 'file' : 'folder',
      keywords: ['open', 'go', ...words(def.label)],
      context: false,
      run: { kind: 'navigate', to: { kind: 'collection', collection: key } },
    };
  });
  places.push(
    {
      id: 'go:media',
      label: 'Media',
      sub: 'Every image and where it is used',
      icon: 'image',
      keywords: ['open', 'go', 'media', 'images'],
      context: false,
      run: { kind: 'navigate', to: { kind: 'media' } },
    },
    {
      id: 'go:schema',
      label: 'Content model',
      sub: plural(collections.length, 'collection', 'collections'),
      icon: 'blocks',
      keywords: ['open', 'go', 'content', 'model', 'schema'],
      context: false,
      run: { kind: 'navigate', to: { kind: 'schema' } },
    },
    {
      id: 'go:content',
      label: 'All content',
      sub: 'Entries · media · model',
      icon: 'table',
      keywords: ['open', 'go', 'all', 'content'],
      context: false,
      run: { kind: 'navigate', to: { kind: 'content' } },
    },
  );
  out.push(...places.filter((a) => a.run.kind === 'navigate' && formatRoute(a.run.to) !== here));

  // After the places: a bare noun (`post`) ties *New post* with the place *Post*, and the place should win Enter.
  for (const [key, def] of collections) {
    if (def.singleton) continue;
    const noun = entryNoun(def.label);
    out.push({
      id: `new:${key}`,
      label: `New ${noun}`,
      sub: def.label,
      icon: 'plus',
      keywords: ['new', 'create', 'add', ...words(noun)],
      context: key === screenCollection,
      run: { kind: 'new', collection: key },
    });
  }

  if (branch !== null) {
    out.push({
      id: 'switch-branch',
      label: 'Switch branch…',
      sub: branch,
      icon: 'branch',
      keywords: ['branch', 'switch', 'checkout'],
      context: route.kind === 'home',
      run: { kind: 'switch-branch' },
    });
  }

  for (const t of THEMES) {
    if (t.choice === theme) continue;
    out.push({
      id: `theme:${t.choice}`,
      label: t.label,
      icon: t.icon,
      // Its own word only: `dark` lists *Use dark appearance*, not the light one too.
      keywords: ['appearance', 'theme', 'mode', t.choice],
      context: false,
      run: { kind: 'theme', choice: t.choice },
    });
  }
  return out;
}

/** An action with its rank for a query (`rankText` over the label and keywords). */
export interface RankedAction {
  action: SearchAction;
  rank: number;
}

/** The actions that match a typed query, best first (a tie keeps `buildActions`' order), at most `ACTION_LIMIT`. */
export function searchActions(actions: readonly SearchAction[], query: string): RankedAction[] {
  return actions
    .flatMap((action) => {
      const r = rankText(action.label, action.keywords, query);
      return r === null ? [] : [{ action, rank: r }];
    })
    .toSorted((a, b) => a.rank - b.rank)
    .slice(0, ACTION_LIMIT);
}

/** The actions under an empty field: the context ones, in order, at most `CONTEXT_LIMIT`. */
export function contextActions(actions: readonly SearchAction[]): SearchAction[] {
  return actions.filter((a) => a.context).slice(0, CONTEXT_LIMIT);
}

export type TopResult = { kind: 'entry'; entry: SearchEntry } | { kind: 'action'; action: SearchAction };

/**
 * What Enter in the field runs: the best-ranked row of either group. A tie goes to the entry (a post titled *Media*
 * opens the post); a disabled action is never it; an empty query has none (Enter does nothing).
 */
export function topResult(
  entries: readonly SearchEntry[],
  actions: readonly RankedAction[],
  query: string,
): TopResult | null {
  if (query.trim() === '') return null;
  const action = actions.find((a) => !a.action.disabled);
  const entry = entries[0];
  const entryRank = entry ? rank(entry, query) : null;
  if (entry && entryRank !== null && (!action || entryRank <= action.rank)) return { kind: 'entry', entry };
  return action ? { kind: 'action', action: action.action } : null;
}
