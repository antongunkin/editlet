# Editlet for Next.js

Connects a Next.js App Router site to Editlet content: `.md` entries with YAML frontmatter under `cms/content/`,
described by `cms/schema.json`.

**Why it exists.** The site reads content from files at build time, and new content arrives through a full redeploy.
There is no runtime GitHub reading and no ISR. In `next dev` the admin and Claude Code edit the same files, and the page
shows the change on the next refresh. The adapter does the Next-specific glue so the site needs no route files and no
CLI.

**What it is.** A `next.config` wrapper, a typed reader, and a tiny loader component.

```ts
// next.config.ts
import { withEditlet } from 'editlet/next/config';
export default withEditlet({ reactStrictMode: true });
```

```ts
// src/lib/cms.ts — the one typed binding a site writes
import { createReader } from 'editlet/next';
import type { EntryMap } from '../../.editlet/content';
export const { getEntries, getEntry, getRef, getReferrers } = createReader<EntryMap>();
```

```tsx
// app/layout.tsx
import { EditletLoader } from 'editlet/next';
// …
<body>
  {children}
  <EditletLoader />
</body>;
```

Add `/.editlet/` and `/public/editlet/` to `.gitignore`. Both are generated.

## Features

| Feature | Doc |
|---|---|
| Typed reads in Server Components, `generateStaticParams`, `generateMetadata`; images, references, drafts | [docs/next/reading.md](../../../docs/next/reading.md) |
| Referenced entries several levels deep (`depth`), "used by" (`getReferrers`), the `Resolved` type | [docs/next/reading.md](../../../docs/next/reading.md#references) |
| `withEditlet`: what happens in `next dev`, `next build` and other phases; generated files | [docs/next/config.md](../../../docs/next/config.md) |
| Dev file API at `/__editlet` without a route file; the production build guard | [docs/next/dev-api.md](../../../docs/next/dev-api.md) |
| Admin at `/editlet/` and content images in `public/editlet/` | [docs/next/admin-and-images.md](../../../docs/next/admin-and-images.md) |
| Production editing: `admin` option, `config.json`, auth handler route | [docs/admin/production.md](../../../docs/admin/production.md) |
| `EditletLoader`: the `?editlet` editor over the page | [docs/next/loader.md](../../../docs/next/loader.md) |
| Live preview: `admin.preview`, the `editlet/next/preview` route (signed draft-mode cookie), `previewRef()`, the reader's `{ ref }` option, `editletField()` marks | [docs/next/preview.md](../../../docs/next/preview.md) |

## Configuration

| `withEditlet(nextConfig, options)` option | Default | Use |
|---|---|---|
| `root` | `process.cwd()` | Repo root |
| `schemaPath` | `cms/schema.json` | Schema file, relative to `root` |
| `typesFile` | `.editlet/content.d.ts` | Where generated types go |
| `admin` | none | Public admin config written to `config.json`: `repo` (`owner/name`, default from Vercel or `GITHUB_REPOSITORY`), `authUrl`, `sessionMinutes` (idle timeout of the admin session, default `CMS_SESSION_MINUTES`, else 60), `param` (the query parameter that opens the editor, default `EDITLET_PARAM`, else `editlet`; `withEditlet` inlines it into `<EditletLoader />`). Everything here is public ([production](../../../docs/admin/production.md)) |

| `createReader(options)` option | Default | Use |
|---|---|---|
| `root`, `schemaPath` | as above | Same project |
| `drafts` | `true` in dev, `false` when `NODE_ENV === 'production'` | Include `draft: true` entries |

`nextConfig` may be an object or Next's phase function.

## Files

| File | Role |
|---|---|
| `config.ts` | `withEditlet`: phases, rewrites/redirects merge, watchers, build hook |
| `reader.ts`, `assetUrl.ts` | `createReader`, `assetUrl`, `CONTENT_URL` |
| `devServer.ts` | Dev-only `node:http` bridge to `createDevHandler`; `startDevApi` refuses to run in production |
| `publicDir.ts` | Rebuilds `public/editlet/` (admin + content images) |
| `buildGuard.ts` | Finds dev-handler code in the build output |
| `EditletLoader.tsx` | `'use client'` loader mount |
| `previewEnv.ts` | Reads the non-secret `EDITLET_PREVIEW` config |
| `previewCookie.ts`, `preview.ts`, `previewRef.ts` | Signed preview cookie (Web Crypto HMAC); `POST`/`DELETE` preview route; `previewRef()` |
| `stub/index.html` | Placeholder admin until the admin build exists (`admin/dist/` in the repo, `dist/admin/dist/` installed) |

Design record: `docs/superpowers/specs/2026-11-10-octocms-v2-p4-next-design.md`.
