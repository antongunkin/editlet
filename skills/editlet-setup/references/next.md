# Next.js setup

For Next.js App Router sites: `next >=16`, `react >=19`. Paths below assume a `src/` folder; drop `src/` when the
project has `app/` at the root.

## 1. Config

Wrap the existing export. Keep every existing option, and keep the file's language (`.ts`, `.mjs`).

```ts
// next.config.ts
import type { NextConfig } from 'next';
import { withEditlet } from 'editlet/next/config';

const nextConfig: NextConfig = {
  // the existing options, unchanged
};

export default withEditlet(nextConfig);
```

- An existing phase function (`export default (phase) => ({ … })`) also works: `withEditlet(fn)`.
- Other wrappers (`withMDX(…)`, `withSentryConfig(…)`) stay; put `withEditlet` innermost:
  `export default withSentryConfig(withEditlet(nextConfig), …)`.
- `withEditlet` writes `.editlet/content.d.ts` and `public/editlet/` when `next dev` or `next build` starts, and in
  `next dev` it serves the dev file API at `/__editlet`. Options for the live site go in a second argument (see
  [production](production.md)).

## 2. `.gitignore`

Append, if missing:

```text
/.editlet/
/public/editlet/
```

## 3. The loader in the root layout

Add the import and render `<EditletLoader />` as the last child of `<body>`, after `{children}`. Change nothing else.

```tsx
// src/app/layout.tsx
import { EditletLoader } from 'editlet/next';

// inside <body>:
{children}
<EditletLoader />
```

`<EditletLoader />` renders nothing until the URL has `?editlet`. With several root layouts (route groups), add it to
each.

## 4. Schema and content

If `cms/schema.json` does not exist and the project has no content to migrate, create a minimal schema and one entry
so `?editlet` has something to show. Say that it is a sample.

```json
{
  "contentDir": "cms/content",
  "git": { "baseBranch": "main" },
  "collections": {
    "post": {
      "label": "Post",
      "titleField": "title",
      "slugFrom": "title",
      "fields": {
        "title": { "type": "string", "label": "Title", "required": true },
        "publishedAt": { "type": "datetime", "label": "Published at" },
        "body": { "type": "markdown", "label": "Body" }
      }
    }
  }
}
```

`git.baseBranch` is the branch the site deploys from: check `git symbolic-ref refs/remotes/origin/HEAD` or ask.

`cms/content/post/hello-world.md`:

```md
---
title: Hello world
publishedAt: 2026-01-15T09:00:00Z
---

The first post. Edit it at `/?editlet`.
```

If the project already has Markdown, MDX or another CMS, do not create sample content: offer `editlet-migrate`.

## 5. The reader

Only if the human wants pages to read Editlet content (or a migration needs it):

```ts
// src/lib/cms.ts
import { createReader } from 'editlet/next';
import type { EntryMap } from '../../.editlet/content';

export const { getEntries, getEntry, getRef } = createReader<EntryMap>();
```

The type import path is relative to the file: `../../.editlet/content` from `src/lib/`, `../.editlet/content` from
`lib/`. Use the functions in Server Components:

```ts
const posts = await getEntries('post'); // sorted by slug; drafts are left out of production builds
const post = await getEntry('post', 'hello-world'); // undefined when missing
```

Markdown bodies with images need `assetUrl(entry, url)` from `editlet/next` in the Markdown renderer's URL transform.
Image fields already hold the public URL in `src`.

To let the editor point at an entry on the page, add `data-editlet-entry="post/hello-world"` to the element that shows
it. The same mark turns on select to edit (select words of the entry, press **Edit**).

## 6. Verify

```bash
node .claude/skills/editlet/scripts/types.mjs
node .claude/skills/editlet/scripts/validate.mjs
npm run build
```

Then start the dev server in the background on a free port and check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/__editlet/files   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/editlet/index.html # 200
```

Stop the server when done unless the human wants it running. Give the human `http://localhost:3000/?editlet`.

## Do not add unasked

- `app/api/editlet/preview/route.ts` (only with `admin.preview`, see [preview](preview.md));
- the auth route (only for the live site, see [production](production.md));
- pages that render the content.
