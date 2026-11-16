# Reading each source

Where each tool keeps its model and content, and what to watch for. The type mapping is in [mapping](mapping.md).

## Plain Markdown or MDX folders

- Find them: `git ls-files '*.md' '*.mdx' | grep -v -E '^(node_modules|README|CHANGELOG|docs/)'`. Ask which folders
  are content when it is not obvious.
- No config: infer the fields from every file's frontmatter (mapping § plain folder). Read all files, not a sample;
  collect key → count and value types with a short script when there are many.
- Find the reader (`git grep -n -E "gray-matter|readdir|globby|import.meta.glob" -- src app lib`) to learn which keys
  the site uses and how slugs and dates are built.

## Astro content collections

- Model: `src/content.config.ts` (Astro 5+) or `src/content/config.ts` (older). Each `defineCollection` has a loader
  (`glob({ pattern, base })`) and a Zod `schema`.
- Content: the `base` folder of the glob, often `src/content/<name>/`. `reference('x')` fields hold slugs of
  collection `x`.
- After the move, the collection is defined with `editletLoader('<key>')` (or all with `editletCollections()`); remove
  the old `schema` for it (Editlet ignores a Zod schema). That edit is site code: `editlet-setup` § Astro.
- `image()` fields point at files relative to the entry; keep them next to the entry.

## Decap CMS (Netlify CMS), Sveltia CMS

- Model: `public/admin/config.yml` (or `static/admin/`, `admin/`; sometimes `config.yaml`, or a JS config in
  `public/admin/index.html` via `CMS.init`).
- `collections[]` with `folder` (one file per entry) or `files` (fixed files: each becomes a singleton).
- `slug: "{{year}}-{{month}}-{{day}}-{{slug}}"` explains the file names; the file name is the slug to keep.
- `media_folder` (in the repo) and `public_folder` (the URL prefix in values): `/uploads/x.png` →
  `<media_folder>/x.png`. Folder-relative media (`media_folder: ''` on a collection) sits next to the entry already.
- `identifier_field` names the title field: use it as `titleField`.
- `i18n` settings mean locale folders or keys: ask.
- Keep `public/admin/` until the human removes it (rule 6).

## TinaCMS

- Model: `tina/config.ts` (or `.tina/schema.ts` in old versions). `schema.collections[]` with `name`, `path`,
  `format` (`md`, `mdx`, `json`, `yaml`), `fields`, optional `templates`.
- Only `format: md` and `mdx` collections map directly. `json`/`yaml` collections: each file becomes an entry; its
  data becomes frontmatter with an empty body.
- `rich-text` with `isBody: true` is the body. Rich-text with `templates` (embedded components) is MDX: see mapping §
  Bodies.
- `ui.component`, `ui.validate` and `ui.format` are UI hints; read them for `text` vs `string` and options.
- Keep `tina/` and the `tinacms` scripts until the human removes them.

## Keystatic

- Model: `keystatic.config.ts` (`collections` and `singletons`). Each collection has `path` (`content/posts/*`),
  `slugField`, `format` (`{ contentField: 'content' }` means a Markdoc/MDX body; `data: 'yaml' | 'json'`).
- `path` ending in `/*` means a folder per entry with `index.mdoc` / `index.yaml`; a path ending in `*` means one file
  per entry. The slug is the folder or file name.
- `.mdoc` (Markdoc) bodies: plain Markdown parts move as they are; Markdoc tags (`{% … %}`) are like MDX components
  (mapping § Bodies).
- Singletons become Editlet singletons.

## Contentlayer

- Model: `contentlayer.config.ts`: `defineDocumentType(() => ({ name, filePathPattern, contentType, fields,
  computedFields }))`.
- `computedFields` (slug, url, reading time) are not content: the site computes them. Do not migrate them; check the
  slug rule they encode and keep the resulting slugs.
- `contentType: 'mdx'`: see mapping § Bodies.

## Front Matter CMS

- Model: `frontmatter.json`: `frontMatter.taxonomy.contentTypes[]` with `fields`, and `frontMatter.content.pageFolders`
  for the folders.
- Field types are close to Editlet's (`string`, `datetime`, `boolean`, `image`, `choice` → `select`, `tags`/`list` →
  `string` list, `fields` → mapping § objects).
