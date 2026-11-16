# Content format

Read this before writing any entry. The schema in `cms/schema.json` decides which fields exist. This page explains how
each field is written in the file.

## Entry files

- Path: `<contentDir>/<collection>/<slug>.md`, and `contentDir` is usually `cms/content`. A singleton collection
  (`"singleton": true`) has exactly one file: `<contentDir>/<collection>/index.md`.
- Slug: lowercase letters and digits, single hyphens: `^[a-z0-9]+(?:-[a-z0-9]+)*$`. If the collection has `slugFrom`,
  make the slug from that field: lowercase it, turn each run of other characters into `-`, and trim the `-` at both
  ends. Transliterate non-Latin titles.
- File: UTF-8. A `---` line, YAML frontmatter, a `---` line, then the Markdown body. One blank line after the closing
  `---` is optional.
- Only `.md` entries sit directly in the collection folder. A folder next to an entry (`post/hello-world/`) can hold
  its images. Any other file in `contentDir` is an error (`Not an entry file`). The exceptions are image files and
  hidden paths (a segment that starts with `.`).
- Write keys in the schema's field order. Leave out empty optional fields; never write `null` or `''` for them.
- The YAML 1.2 core schema is used: `2026-01-15` stays text, while `yes`, `no`, `on` and `off` are strings. Quote a
  string that another reader would see as a different type: `'yes'`, `'true'`, `'null'`, `'~'`, `'123'`, `'12:30'`,
  `'1_000'`. Also quote a string that starts with `*`, `&`, `!`, `%`, `@`, `` ` ``, `#`, `[`, `{`, `-`, `?`, `|`, `>`,
  `'` or `"`, or that contains `: ` or ` #`. When in doubt, quote.

## Field types

Every field has `label` and may have `required` and `hint`. An optional field may be absent.

| Type | YAML value | Notes |
|---|---|---|
| `string` | `title: Hello world` | One line of text. With `list: true` it is a list: `tags: [news, release]` |
| `text` | `summary: \|` followed by indented lines | Multi-line text. Use a block scalar (`\|` keeps line breaks) |
| `markdown` | the body below the frontmatter | At most one per collection. A collection without one must have an empty body |
| `boolean` | `featured: true` | `true` / `false`, never quoted |
| `select` | `status: live` | One of the option **values** (not labels). With `multiple: true` it is a list: `[a, b]` |
| `number` | `price: 19.5` | `min` / `max` / `integer` from the schema apply. Never quoted |
| `datetime` | `publishedAt: 2026-01-15T09:00:00Z` | ISO 8601 with `Z`, an offset, or local time. With `dateOnly: true` use `2026-01-15` |
| `json` | any YAML value: a mapping, a list or a scalar | Free-form |
| `url` | `link: https://example.com` or `link: /about` | `http(s)://…` or a root-relative path (one leading `/`) |
| `color` | `accent: '#1a2b3c'` | `#` plus 6 hex digits. **Quote it**: an unquoted `#` starts a YAML comment |
| `image` | `cover:` with `src: …` and `alt: …` on two indented lines | See [Images](#images) |
| `reference` | `author: author/jane` | `collection/slug` of an existing entry, from the field's `collections`. With `multiple: true` it is a list. `min` / `max` limit the list length |
| `object` | `seo:` with its fields on indented lines | The `fields` of the schema, nested. With `list: true` it is a list of such objects. See [Objects and blocks](#objects-and-blocks) |
| `blocks` | `content:` with a list of items, each starting `- block: <kind>` | Each item is one of the field's `blocks`, with that kind's fields. See [Objects and blocks](#objects-and-blocks) |

`draft` is not a field. `draft: true` hides the entry from the public site. Remove the line, or write `draft: false`,
to publish it on the next deploy. Follow the user's intent. If they did not say whether the entry should go live,
create it with `draft: true` and tell them.

### Example: an entry with every common field

```md
---
title: Spring sale
summary: |
  Two weeks of discounts.
  Ends April 30.
status: live
featured: true
price: 49
publishedAt: 2026-03-01T09:00:00Z
link: /shop
accent: '#ff6600'
cover:
  src: spring-sale/hero.webp
  alt: Shop window with spring flowers
author: author/jane
related:
  - post/hello-world
  - post/winter-recap
keywords: [sale, spring]
---

## Objects and blocks

Inside an `object` or a block, write the nested fields with the same rules as top-level ones, indented under the key.
A nested `markdown` field is a Markdown string (use `|`), not the body.

```yaml
seo:
  title: Spring sale
  image:
    src: spring-sale/share.webp
    alt: Tulips in a shop window
features:            # object with list: true
  - title: Fast
    text: One page, one file.
  - title: Private
content:             # blocks: every item starts with its kind
  - block: hero
    title: Spring sale
    cta:             # an object inside a block
      label: Shop now
      url: /shop
  - block: prose
    text: |
      Two weeks of **discounts**.

      ![Chart](spring-sale/chart.webp)
  - block: survey
    survey: survey/spring-feedback   # a reference inside a block
```

- `block` must be one of the field's block kinds; the rest of the item are that kind's fields. Write `block` first.
- The order of a list is the order on the page. To move a block, move its whole item (every line of it).
- Leave empty optional nested fields out, and leave out an `object` whose fields would all be empty.
- Images inside follow [Images](#images): `src` is relative to the entry's folder, at any depth.
- Issues name the full path: `content.2.title — Required`, `features.0.title — Required`,
  `content.1.block — Expected block: hero, prose, survey`.
- A part that has a life of its own (reused, named, its own draft) belongs in a collection and a reference, not in
  a block.

## The body

Markdown text, with **any** formatting the site supports.
```

`keywords` is a `string` field with `list: true` (plain text values). A `datetime` field needs a full ISO datetime;
a bare date such as `2026-03-01` is valid only when the field has `dateOnly`. A reference list uses
`collection/slug` values (`related` above).

## Images

1. Put the file inside `contentDir`. The usual place is a folder named after the entry:
   `cms/content/post/spring-sale/hero.webp`. A shared folder such as `cms/content/media/` also works.
2. Allowed extensions: `webp png jpg jpeg avif gif svg`. File and folder names must not start with `.`.
3. `src` is relative to the **entry file's folder** (`cms/content/post/`). For the file above it is
   `spring-sale/hero.webp`. A shared folder is reached with `../media/logo.png`. A leading `/`, a URL, or a path
   outside `contentDir` is invalid.
4. `alt` is required and not empty. Describe what the image shows, not its file name.
5. Keep images small: under 500 KB if possible, and never over 1 MB, because the GitHub editor reads files through an
   API with a 1 MB limit. Prefer `webp`. Convert or resize only with a tool that is already installed (`sips` on macOS,
   `cwebp`, ImageMagick `magick`, or `sharp` if the project has it). Otherwise copy the file as it is and mention its
   size.
6. A user-supplied image: copy it into place (`cp`) rather than recreating it. Never download an image from a URL the
   user did not give you. Check that it is an image (`file <path>`) and how big it is; tell the human if it is empty,
   broken or over the limit.
7. Write `alt` from what the image shows. If you cannot see the image, write it from the context the human gave, and
   say so, so they can correct it.

## References

- The value is `<collection>/<slug>`, and a singleton is `<collection>/index`. The target must exist and its
  collection must be listed in the field's `collections`.
- Creating several entries that refer to each other is fine: validation checks the final file set.
- A nested structure (a survey with sections, questions and options) is one collection per level, each level a
  `multiple` reference to the next. Create the leaves first or all in one change; the order inside a list is the order
  on the page.
- Cycles (an option pointing back at its question, an entry pointing at itself) are valid. Do not repeat a reference
  in one list.
- The site code includes referenced entries with `depth` (Next: `getEntry('survey', slug, { depth: 3 })`) or one
  `getEntries` call per level (Astro). Changing references never needs a code change.
- In the admin a reference field has an **Open** link, and every saved entry lists **Used by**: point the human there
  to check a structure.

## Renaming or deleting an entry

Use `refs.mjs`. It finds every reference (inside objects and blocks too) and every image `src` that must follow,
edits only those lines, and checks the whole change before writing. Dry run by default.

```bash
node .claude/skills/editlet/scripts/refs.mjs used-by question/role                 # who references it, by field
node .claude/skills/editlet/scripts/refs.mjs rename question/role team-role         # the plan; writes nothing
node .claude/skills/editlet/scripts/refs.mjs rename question/role team-role --apply # moves the file and its folder, rewrites references and srcs
node .claude/skills/editlet/scripts/refs.mjs remove option/age-draft --apply         # deletes it and removes every reference
```

1. **Rename:** the slug is also the page URL. Say so to the human: links to the old URL on the site or elsewhere stop
   working, and code that reads `getRef('question/role')` must change too (`git grep -n question/role -- ':!cms/'`).
   Commit message: `node .claude/skills/editlet/scripts/style.mjs commit rename question/role team-role`.
2. **Delete:** confirm with the human first, naming the entry and the entries that reference it (`used-by`). `remove`
   refuses when an entry would break (a required reference, a list below `min`, a required field in a block) and
   prints those issues: fix that entry first (another target, or remove the block), then run it again. The entry's
   images stay; delete images only it used with `git rm` if the human wants that.
3. A plan line ends with `(rewritten in standard format)` when a one-line edit could not reproduce the data; check
   that diff.
4. Run `validate` afterwards. A dangling reference shows as `Referenced entry not found: post/x`.

## Common validation messages

| Message | Fix |
|---|---|
| `Unknown field` | The key is not in the schema. Check the spelling, or change the schema first |
| `Required` | Add a non-empty value |
| `Expected one of: a, b` | Use an option **value** from the schema |
| `Referenced entry not found: x/y` | Create the target or fix the slug |
| `Duplicate reference: x/y` | The list already has this reference: remove the repeat |
| `Expected block: a, b` | The item's `block` is missing or not one of the field's kinds |
| `Expected an object` | An `object` field needs indented `key: value` lines, not a scalar |
| `This collection has no markdown field, but the entry has body content` | Move the text into a field, or leave the body empty |
| `Not an entry file` | Move or delete a stray file in `contentDir`, or fix a `.md` path that is nested too deep |
| `Frontmatter is not closed with a "---" line` / `Invalid YAML frontmatter` | Fix the YAML syntax. Quote strings that contain `: ` or `#` |
