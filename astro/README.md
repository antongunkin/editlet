# Editlet for Astro

Puts Editlet content into Astro content collections and the Editlet admin into an Astro site.

**Why it exists.** An Astro site reads Editlet entries (Markdown files with frontmatter under `cms/content/`) like
any other collection: `getCollection`, `getEntry`, `render`, `<Image>`. Editors open the admin with `?editlet` on any page
and, in `astro dev`, edit the local files directly.

**What it is.** Two entry points:

| Import | Export | Use |
|---|---|---|
| `editlet/astro` | `editlet(options?)` (default) | Integration for `astro.config.mjs` |
| `editlet/astro/content` | `editletCollections(options?)`, `editletLoader(collection, options?)` | Collections for `src/content.config.ts` |

## Setup

```js
// astro.config.mjs
import editlet from 'editlet/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [editlet()] });
```

```ts
// src/content.config.ts
import { editletCollections } from 'editlet/astro/content';

export const collections = editletCollections();
```

Then read content as usual: `getCollection('post')`, `getEntry('home', 'index')`, `render(post)`. Full steps in
[docs/astro/setup.md](../../../docs/astro/setup.md).

## What the integration does

1. Adds the `?editlet` loader ([loader](../loader/README.md)) to every page, re-synced on `astro:page-load`.
2. `astro dev` only: serves the dev file API at `/__editlet` and the admin at `/editlet/`.
3. `astro build`: copies the admin into the client output as `editlet/`. No `/__editlet` route is built.
4. Restarts the dev server when `cms/schema.json` changes, so collections and types follow the schema.

## Options

| Option | Default | Use |
|---|---|---|
| `schemaPath` (integration and content helpers) | `cms/schema.json` | Schema file, relative to the Astro root. The content helpers take the integration's value when they get none. |
| `admin` (integration) | none | Public admin config written to `config.json`: `repo` (`owner/name`, default from Vercel or `GITHUB_REPOSITORY`), `authUrl`, `sessionMinutes` (idle timeout of the admin session, default `CMS_SESSION_MINUTES`, else 60), `param` (the query parameter that opens the editor, default `EDITLET_PARAM`, else `editlet`). Everything here is public ([production](../../../docs/admin/production.md)) |

## Features

| Feature | Doc |
|---|---|
| Install, config files, reading content in pages, the example blog | [docs/astro/setup.md](../../../docs/astro/setup.md) |
| Content loader: entry shape, images, references, drafts, errors | [docs/astro/content-loader.md](../../../docs/astro/content-loader.md) |
| Dev server: dev file API, `Host` rule, file watcher, schema restarts | [docs/astro/dev-server.md](../../../docs/astro/dev-server.md) |
| Admin: which folder is served, the stub page, build output, `base` | [docs/astro/admin.md](../../../docs/astro/admin.md) |

## Limits

- Astro `base` is not supported: the admin is always at `/editlet/` and the dev API at `/__editlet`.
- A `schema` you give an Editlet collection is ignored: entries are validated with Editlet rules, not with Zod.
  Astro would type `data` from it, so do not pass one.
- Drafts are left out of `astro build`; a reference to a draft then resolves to `undefined`.
- Content changes ship by a full rebuild (after merge to `main`). There is no live loader and no runtime GitHub read.
- Peer dependency `astro` `^6 || ^7`, optional. Tested on Astro 7.

## Files

| File | Role |
|---|---|
| `index.ts` | Integration: options, page script, schema watch, dev middleware, build emit of the admin |
| `content.ts` | `editletLoader`, `editletCollections`, `toAstroData`, `astroTypes` |
| `devServer.ts` | Dev middleware: `/__editlet` → dev handler, `/editlet/` → static admin files; `adminDir()` |
| `nodeBridge.ts` | Node `IncomingMessage` → Web `Request`, Web `Response` → `ServerResponse` |
| `shared.ts` | Options shared by the integration and the loader (a `globalThis` slot) |
| `stub/index.html` | Placeholder admin until `admin/dist/` exists; speaks the loader protocol minimally |
| `*.test.ts` | Vitest unit tests |

Example site: [`examples/astro/`](../../../examples/astro/). Design record:
`docs/superpowers/specs/2026-11-10-octocms-v2-p5-astro-design.md`.
