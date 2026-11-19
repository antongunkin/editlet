# Astro setup

For Astro sites: `astro ^6 || ^7`. Editlet entries become normal Astro content collections.

## 1. Integration

Add `editlet()` to the existing `integrations` array. Keep every other option.

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import editlet from 'editlet/astro';

export default defineConfig({ integrations: [editlet()] });
```

The integration adds the `?editlet` loader to every page. In `astro dev` it serves the dev file API at `/__editlet` and the
admin at `/editlet/`; in `astro build` it copies the admin into the output. Astro `base` is not supported: if the
config sets `base`, stop and tell the human.

## 2. Collections

Astro generates its own types (`.astro/`); there is nothing to add to `.gitignore`.

If there is no `src/content.config.ts`, create it:

```ts
// src/content.config.ts
import { editletCollections } from 'editlet/astro/content';

export const collections = editletCollections();
```

If the file exists with other collections, keep them and add each Editlet collection with `editletLoader`:

```ts
import { defineCollection } from 'astro:content';
import { editletLoader } from 'editlet/astro/content';

export const collections = {
  // the existing collections, unchanged
  post: defineCollection({ loader: editletLoader('post') }), // no `schema`: Editlet validates
};
```

A collection name must not be defined twice.

## 3. Schema and content

Same as [Next.js § 4](next.md#4-schema-and-content): a minimal `cms/schema.json` and one sample entry only when the
project has no content to migrate.

Then `pluralLabel` and `url` for each collection, as in
[Next.js § page addresses](next.md#page-addresses-and-plural-labels), from Astro's routes:

- `src/pages/<path>/[slug].astro` whose `getStaticPaths` reads `getCollection('<key>')` → `"url": "/<path>/{slug}/"`.
  The path is the folder, not the collection key (`getCollection('bike')` in `src/pages/projects/[slug].astro` →
  `/projects/{slug}/`).
- Match the trailing `/` of the hrefs the site writes (`` <a href={`/posts/${post.id}/`}> ``); without one, follow
  `trailingSlash` in the config (`'always'` → end with `/`).
- `src/pages/index.astro` showing a singleton (`getEntry('home', 'index')`) → `"url": "/"`.
- Routes with other parameters (`[...slug]`, `[lang]/[slug]`) cannot be written: leave `url` out.

## 4. Reading content

Only if the human wants pages to read it:

```astro
---
import { getCollection, getEntry, render } from 'astro:content';
const posts = await getCollection('post'); // id = slug
const home = await getEntry('home', 'index'); // a singleton
const { Content } = await render(posts[0]);
---
<Content />
```

Drafts are left out of `astro build`.

## 5. Verify

```bash
node .claude/skills/editlet/scripts/validate.mjs
npm run build
```

Start `astro dev` in the background (default port 4321) and check `/__editlet/files` and `/editlet/index.html` answer
`200`. Stop it when done. Give the human `http://localhost:4321/?editlet`.

## Limits to mention

- A static Astro site has no server, so the GitHub sign-in handler runs elsewhere (a Cloudflare Worker or a Node
  server, see [production](production.md)).
- Live preview on Astro is the page overlay only; the server-side draft render is Next.js only.
