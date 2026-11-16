# Editlet loader

Opens the Editlet admin over your site when the URL has `?editlet`.

**Why it exists.** The admin is a separate static app. Its code must never be in the site bundle, and it must work with
any framework. Every page gets only this loader instead: a zero-dependency script (≈5.0 KB minified, ≈2.1 KB gzip).
When the URL has `?editlet…`, it opens the admin in a floating, non-modal `<dialog>` with an `<iframe>`. The iframe isolates the admin's
CSS and JS from the site.

**What it is.** One function, `mountEditletLoader(options) → { sync, close, destroy }`, plus `protocol.ts`, the frozen
`postMessage` contract between site and admin. The Next.js and Astro adapters mount the loader for you.

## How it works

1. On page load the loader reads `location.search`. Without `editlet` it only adds a `popstate` and a `message` listener.
2. With `?editlet=<route>` it opens a floating dialog with an iframe of `<adminUrl>?editlet=<route>`.
3. The admin posts `ready`, and the loader answers `init` with the route and the site URL.
4. Then the admin drives the loader: it sends `navigate`, `close`, `refresh` and `highlight`. `window.js`, injected from the admin dist, moves and resizes the window. The loader keeps
   `?editlet=` in the page URL equal to the admin's route.

```ts
import { mountEditletLoader } from 'editlet/loader';

mountEditletLoader(); // admin at /editlet/, page reload after a save
```

## Features

| Feature | Doc |
|---|---|
| Opening and closing: `?editlet` routes, the dialog, Escape, the safety close button | [docs/loader/open-close.md](../../../docs/loader/open-close.md) |
| URL sync, Back/Forward, client-side navigation in Next.js and Astro | [docs/loader/url-sync.md](../../../docs/loader/url-sync.md) |
| The floating window: drag, resize, bottom sheet on narrow screens, collapse to a pill, themes (`window.js` and the admin chrome) | [docs/loader/window.md](../../../docs/loader/window.md) |
| Highlighting entries on the page, refresh after save | [docs/loader/highlight.md](../../../docs/loader/highlight.md) |
| Select to edit: Edit button next to a selection on the page, Alt+Shift+E (`window.js`) | [docs/loader/select.md](../../../docs/loader/select.md) |
| Live preview of unsaved edits on the page (`preview.js`, injected for editors only) | [docs/loader/preview.md](../../../docs/loader/preview.md) |
| `postMessage` protocol v1: messages, trust checks, rules for the admin | [docs/loader/protocol.md](../../../docs/loader/protocol.md) |
| Serving the admin: same origin, no CDN, headers, sandbox, size budget | [docs/loader/hosting.md](../../../docs/loader/hosting.md) |

## Configuration

| Option | Default | Use |
|---|---|---|
| `adminUrl` | `'/editlet/'` | Where the site serves the admin page. Relative values resolve against the page. |
| `param` | `'editlet'` (`EDITLET_PARAM`) | The query parameter of the site's pages that opens the editor. The admin's own URL keeps `editlet`; see [open-close](../../../docs/loader/open-close.md#another-parameter-name). |
| `onRefresh` | `location.reload()` | Runs when the admin reports a save. Next.js passes `() => router.refresh()`. |
| `replaceUrl` | `(u) => history.replaceState(history.state, '', u)` | Writes the page URL. Next.js App Router passes `(u) => history.replaceState(null, '', u)`; see [url-sync](../../../docs/loader/url-sync.md). |

`mountEditletLoader()` is idempotent: a second call returns the same instance. `sync()` re-reads the URL, `close()` closes
the editor and removes `?editlet`, and `destroy()` removes everything (useful for tests and HMR).

## Try it

```bash
npx vite packages/editlet/loader/demo
```

Open `/?editlet=post/hello-world`. The demo has a stub admin with buttons for every message.

## Files

| File | Role |
|---|---|
| `index.ts` | `mountEditletLoader`: dialog, iframe, URL sync, message handling |
| `protocol.ts` | Frozen v1 contract: constants, message types, builders, guards, `?editlet` URL helpers (no DOM) |
| `demo/` | Plain-HTML site page and a stub admin (`demo/editlet/admin.ts`) that shows the admin rules |
| `*.test.ts` | Vitest + jsdom tests; `size.test.ts` enforces the size budget |

Design record: `docs/superpowers/specs/2026-11-10-octocms-v2-p3-loader-design.md`.
