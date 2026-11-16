# Field mapping

How source fields become Editlet fields. The Editlet field types and their YAML are in the `editlet` skill's
[content format](../../editlet/references/content-format.md); the schema keys per type are in
[schema changes](../../editlet/references/schema-changes.md).

## Keys

- Editlet keys match `^[a-zA-Z][a-zA-Z0-9]*$`. Convert `snake_case` and `kebab-case` to camelCase: `show_banner` →
  `showBanner`, `meta-title` → `metaTitle`. `draft` is reserved: a source `draft: true` stays as Editlet's `draft`
  line, never a field.
- Keep the source key when it is already valid. Rename only for a clear reason (`date` → `publishedAt` is optional;
  say so if you do it, because site code reads the key).
- Collection keys: camelCase, singular is the convention (`post`, `author`), but keeping the source name (`blog`) is
  fine. A Decap "file" collection or a Tina/Keystatic singleton becomes `"singleton": true` with `index.md`.

## Types

| Source | Editlet | Notes |
|---|---|---|
| Decap `string`; Tina `string`; Keystatic `fields.text`, `fields.slug`; Zod `z.string()` | `string` | |
| Decap `text`; Tina `string` with `ui.component: 'textarea'`; Keystatic `fields.text({ multiline: true })` | `text` | |
| Decap `markdown` body; Tina `rich-text` (`isBody`); Keystatic `fields.markdoc`, `fields.mdx`, `fields.document`; the Markdown body of any file | `markdown` | The body. At most one per collection; a second rich-text field becomes `text` |
| Decap `boolean`; Tina `boolean`; Keystatic `fields.checkbox`; `z.boolean()` | `boolean` | |
| Decap `number` (`value_type: int` → `integer: true`); Tina `number`; Keystatic `fields.integer`, `fields.number`; `z.number()` | `number` | Copy `min`, `max`, `step` |
| Decap `datetime`; Tina `datetime`; Keystatic `fields.datetime`; `z.date()`, `z.coerce.date()` | `datetime` | Values that are dates only (`2024-01-10`) → `dateOnly: true`; never invent a time |
| Decap `date`; Keystatic `fields.date` | `datetime` with `dateOnly: true` | |
| Decap `select` (`multiple` → `multiple: true`); Tina `string` with `options`; Keystatic `fields.select`, `fields.multiselect`; `z.enum([...])` | `select` | Options `{ label, value }`; a plain string option has label = value |
| Decap `list` without `fields`; Tina `string` with `list: true`; Keystatic `fields.array(fields.text())`; `z.array(z.string())` | `string` with `list: true` | A scalar value in one file (`tags: release`) becomes a one-item list |
| Decap `relation`; Tina `reference`; Keystatic `fields.relationship`; Astro `reference('authors')` | `reference` with `collections` | Values become `collection/slug`. A list → `multiple: true` |
| Decap `image`; Tina `image`; Keystatic `fields.image`; Astro `image()` | `image` | `src` + `alt`. Alt from a sibling key if there is one, else ask or write it from context and say so |
| Decap `color`; Keystatic text with a hex pattern | `color` | Value `'#rrggbb'`, quoted |
| Decap `file`; Keystatic `fields.file` | `url` | The file stays where it is served from; Editlet stores only images |
| Decap `object` with scalar fields; Tina `object` (not `list`) | One field per subfield, prefixed: `seo.meta_title` → `seoMetaTitle` | Say that site code must read the new keys. If the human prefers one value, `json` |
| Decap `list` with `fields`, Decap `types`; Tina `object` with `list: true` or `templates`; Keystatic `fields.array(fields.object())`, `fields.blocks`; nested Zod objects | `json` | Kept as the same YAML value. The editor shows it as JSON, not a form: list it as a loss of form UI |
| Decap `hidden`; computed values | Keep as the matching scalar type, or drop if the site computes it | Ask |
| Decap `code`; Keystatic `fields.code` | `text` | |
| A plain folder without a config | Infer from values: all `true`/`false` → `boolean`; numbers → `number`; ISO date → `datetime` (+ `dateOnly`); `#rrggbb` → `color`; lists → `string` list; a path to an image → `image`; else `string` | A key with mixed types: the widest (`string`), and list the odd files |

`required`: set it only when every migrated entry has a non-empty value; otherwise leave it off and list the entries
that lack it.

## Values

- Dates: write ISO 8601. `"2024-02-03 10:30"` → `2024-02-03T10:30:00` (local time, as the source had no zone).
  Never shift a date into another day.
- References: a Decap relation with `value_field: "{{slug}}"` already holds the slug; prefix the collection
  (`jane-doe` → `author/jane-doe`). A value that is a display name ("Jane Doe") needs the target entry's slug; create
  the target entries first.
- Images: a root-relative path (`/images/hello.png`, `/uploads/x.png`) points into `public/` (Next, Astro). `git mv`
  the file next to the entry and write `src` relative to the entry file's folder (`hello/hello.png`). A URL to another
  host stays a `url` field or is downloaded only if the human asks.
- Images in the body (`![alt](/images/inline.png)`): move them too and rewrite the link relative to the entry. The
  site renders body images through `assetUrl` (Next) or Astro's Markdown pipeline.
- `draft: true` stays. `published: false` becomes `draft: true` if that is what it means; ask if unsure.

## Bodies

- `.md` stays `.md`. `.mdx` without `import`, `export` or JSX tags is renamed to `.md`.
- `.mdx` with `import` or JSX cannot become an Editlet entry as it is. Offer: (a) strip the components and keep the
  text, (b) keep the body as Markdown with the JSX lines as text (shown raw), or (c) leave that collection outside
  Editlet. Astro can mix collections with `editletLoader`; Next can keep its own reader for those files.
- A collection with no body in the source gets no `markdown` field, and its entries keep an empty body.

## Losses to list before the yes

- keys you were asked to drop, with entry counts;
- `json` fields (no form UI);
- MDX components;
- slug changes;
- entries without a value for a field that was required in the source;
- multiple rich-text fields reduced to one `markdown` field;
- i18n folders (`en/`, `de/`): one collection per locale, or out of scope; ask.
