/** An admin screen, as encoded in the `?editlet` param. Collection existence is checked by the screens, not here. */
export type Route =
  | { kind: 'home' }
  | { kind: 'collection'; collection: string }
  | { kind: 'entry'; collection: string; slug: string }
  | { kind: 'schema' }
  | { kind: 'media' }
  | { kind: 'branch'; name: string }
  | { kind: 'unknown'; raw: string };

const BRANCH_PREFIX = 'branch:';

export function parseRoute(raw: string | null): Route {
  if (raw === null || raw === '') return { kind: 'home' };
  if (raw === 'schema') return { kind: 'schema' };
  if (raw === 'media') return { kind: 'media' };
  if (raw.startsWith(BRANCH_PREFIX)) {
    const name = raw.slice(BRANCH_PREFIX.length);
    return name === '' ? { kind: 'unknown', raw } : { kind: 'branch', name };
  }
  const segments = raw.split('/');
  if (segments.some((s) => s === '')) return { kind: 'unknown', raw };
  if (segments.length === 1) return { kind: 'collection', collection: segments[0]! };
  if (segments.length === 2) return { kind: 'entry', collection: segments[0]!, slug: segments[1]! };
  return { kind: 'unknown', raw };
}

/**
 * The screen one level up, for Back: an entry goes to its collection, every other screen goes Home, Home has none.
 * It is the place in the content tree, not browser history, so Back works after a deep link too.
 */
export function parentRoute(r: Route): Route | null {
  switch (r.kind) {
    case 'home':
      return null;
    case 'entry':
      return { kind: 'collection', collection: r.collection };
    case 'collection':
    case 'schema':
    case 'media':
    case 'branch':
    case 'unknown':
      return { kind: 'home' };
  }
}

export function formatRoute(r: Route): string {
  switch (r.kind) {
    case 'home':
      return '';
    case 'collection':
      return r.collection;
    case 'entry':
      return `${r.collection}/${r.slug}`;
    case 'schema':
      return 'schema';
    case 'media':
      return 'media';
    case 'branch':
      return `${BRANCH_PREFIX}${r.name}`;
    case 'unknown':
      return r.raw;
  }
}
