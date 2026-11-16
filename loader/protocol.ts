// FROZEN CONTRACT v1 — see spec §4; additive changes keep v, breaking changes bump EDITLET_PROTOCOL_VERSION in a
// separate PR.

export const EDITLET_SOURCE = 'editlet' as const;
export const EDITLET_PROTOCOL_VERSION = 1 as const;
/** Default query parameter that opens the editor on a site page; sites may set another (`EDITLET_PARAM` env). */
export const EDITLET_PARAM = 'editlet' as const;
export const DEFAULT_ADMIN_URL = '/editlet/' as const;
export const ENTRY_ATTR = 'data-editlet-entry' as const;
export const HIGHLIGHT_ATTR = 'data-editlet-highlight' as const;
export const FIELD_ATTR = 'data-editlet-field' as const;

// Preview contract (P12): names shared by the loader, the preview script and the admin.
// Plain literals, not template literals over EDITLET_SOURCE: esbuild keeps those in the loader bundle (2 KB gzip budget).
export const PREVIEW_FLAG_KEY = 'editlet:preview' as const; // localStorage key; value = branch name
export const PREVIEW_CHANNEL = 'editlet:preview' as const; // BroadcastChannel name
export const PREVIEW_DB = 'editlet-preview' as const;
export const PREVIEW_STORE = 'snapshot' as const;
export const PREVIEW_KEY = 'current' as const;
export const PREVIEW_SCRIPT = 'preview.js' as const; // resolved against the admin URL
export const WINDOW_SCRIPT = 'window.js' as const; // floating-window shell (drag, resize, dock), resolved against the admin URL
export const PREVIEW_ROUTE = '/api/editlet/preview' as const;

export type AdminLayout = 'full' | 'side';

type Envelope<T extends string> = { source: typeof EDITLET_SOURCE; v: typeof EDITLET_PROTOCOL_VERSION; type: T };

export type ReadyMessage = Envelope<'ready'>;
export type AdminNavigateMessage = Envelope<'navigate'> & { route: string };
export type CloseMessage = Envelope<'close'>;
export type RefreshMessage = Envelope<'refresh'>;
export type HighlightMessage = Envelope<'highlight'> & { entry: string | null };
export type LayoutMessage = Envelope<'layout'> & { layout: AdminLayout };
export type AdminToSiteMessage =
  | ReadyMessage
  | AdminNavigateMessage
  | CloseMessage
  | RefreshMessage
  | HighlightMessage
  | LayoutMessage;

export type InitMessage = Envelope<'init'> & { route: string; site: { origin: string; href: string } };
export type SiteNavigateMessage = Envelope<'navigate'> & { route: string };
export type CloseRequestMessage = Envelope<'close-request'>;
export type SiteToAdminMessage = InitMessage | SiteNavigateMessage | CloseRequestMessage;

export type MessageBody<M> = M extends unknown ? Omit<M, 'source' | 'v'> : never;

export function adminMessage(body: MessageBody<AdminToSiteMessage>): AdminToSiteMessage {
  return { source: EDITLET_SOURCE, v: EDITLET_PROTOCOL_VERSION, ...body } as AdminToSiteMessage;
}

export function siteMessage(body: MessageBody<SiteToAdminMessage>): SiteToAdminMessage {
  return { source: EDITLET_SOURCE, v: EDITLET_PROTOCOL_VERSION, ...body } as SiteToAdminMessage;
}

function envelope(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  return d.source === EDITLET_SOURCE && d.v === EDITLET_PROTOCOL_VERSION && typeof d.type === 'string' ? d : null;
}

export function isAdminToSiteMessage(data: unknown): data is AdminToSiteMessage {
  const d = envelope(data);
  if (!d) return false;
  switch (d.type) {
    case 'ready':
    case 'close':
    case 'refresh':
      return true;
    case 'navigate':
      return typeof d.route === 'string';
    case 'highlight':
      return d.entry === null || typeof d.entry === 'string';
    case 'layout':
      return d.layout === 'full' || d.layout === 'side';
    default:
      return false;
  }
}

export function isSiteToAdminMessage(data: unknown): data is SiteToAdminMessage {
  const d = envelope(data);
  if (!d) return false;
  switch (d.type) {
    case 'init': {
      const site = d.site as Record<string, unknown> | null | undefined;
      return (
        typeof d.route === 'string' &&
        typeof site === 'object' &&
        site !== null &&
        typeof site.origin === 'string' &&
        typeof site.href === 'string'
      );
    }
    case 'navigate':
      return typeof d.route === 'string';
    case 'close-request':
      return true;
    default:
      return false;
  }
}

const BASE = 'http://x';
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

function paramName(segment: string): string {
  const raw = segment.split('=')[0]!.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The `param` param of `url` (default `editlet`): `null` when absent, `''` for `?editlet` / `?editlet=`. Relative
 * inputs are resolved as root-relative (against `/`, not against any page); pass absolute URLs or `URL` objects for
 * anything else.
 */
export function readEditletRoute(url: string | URL, param: string = EDITLET_PARAM): string | null {
  return new URL(url, BASE).searchParams.get(param);
}

/**
 * `url` with `param` (default `editlet`) set to `route` (`null` removes it), other params and the hash kept. Absolute in → absolute out;
 * relative in → root-relative out. Relative inputs are resolved as root-relative (`'admin/'` → `/admin/`); pass
 * absolute URLs or `URL` objects for anything else.
 */
export function withEditletRoute(url: string | URL, route: string | null, param: string = EDITLET_PARAM): string {
  const protocolRelative = typeof url === 'string' && url.startsWith('//');
  const absolute = typeof url !== 'string' || ABSOLUTE.test(url);
  const u = new URL(url, BASE);
  const segments = u.search
    .slice(1)
    .split('&')
    .filter((seg) => seg !== '' && paramName(seg) !== param);
  if (route !== null) {
    const encoded = encodeURIComponent(route).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
    segments.push(route === '' ? param : `${param}=${encoded}`);
  }
  u.search = segments.join('&');
  if (protocolRelative) return `//${u.host}${u.pathname}${u.search}${u.hash}`;
  return absolute ? u.href : `${u.pathname}${u.search}${u.hash}`;
}

export type PreviewValue =
  | { text: { from: string; to: string } }
  // `from` is the asset path relative to contentDir (e.g. `post/hello/cover.webp`); `to` is the new image bytes.
  | { image: { from: string; to: Blob; alt?: { from: string; to: string } } }
  | { stale: true };

export interface PreviewSnapshot {
  v: 1;
  branch: string;
  expiresAt: number;
  entries: Record<string, Record<string, PreviewValue>>;
}

export type PreviewChannelMessage = { source: typeof EDITLET_SOURCE; type: 'snapshot' };

export function fieldMark(entry: string, field: string): string {
  return `${entry}#${field}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPreviewValue(v: unknown): v is PreviewValue {
  if (!isRecord(v)) return false;
  if (v.stale === true) return true;
  if (isRecord(v.text)) return typeof v.text.from === 'string' && typeof v.text.to === 'string';
  if (isRecord(v.image)) return typeof v.image.from === 'string' && v.image.to instanceof Blob;
  return false;
}

// Shape check only (no deep schema).
export function isPreviewSnapshot(v: unknown): v is PreviewSnapshot {
  if (!isRecord(v) || v.v !== 1 || typeof v.branch !== 'string' || typeof v.expiresAt !== 'number') return false;
  if (!isRecord(v.entries)) return false;
  return Object.values(v.entries).every((fields) => isRecord(fields) && Object.values(fields).every(isPreviewValue));
}

export function isPreviewChannelMessage(v: unknown): v is PreviewChannelMessage {
  return isRecord(v) && v.source === EDITLET_SOURCE && v.type === 'snapshot';
}
