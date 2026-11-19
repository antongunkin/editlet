# Schema changes

`cms/schema.json` is the content model. The dev server, the `?editlet` editor and the site build all read it, so a broken
or incompatible schema breaks them at once. Always run a dry run first.

## The schema in one minute

```json
{
  "contentDir": "cms/content",
  "git": { "baseBranch": "main" },
  "collections": {
    "post": {
      "label": "Post",
      "pluralLabel": "Posts",
      "url": "/posts/{slug}",
      "titleField": "title",
      "slugFrom": "title",
      "fields": {
        "title": { "type": "string", "label": "Title", "required": true },
        "body": { "type": "markdown", "label": "Body" }
      }
    },
    "homePage": { "label": "Home page", "singleton": true, "fields": { "title": { "type": "string", "label": "Title" } } }
  }
}
```

- Collection and field keys match `^[a-zA-Z][a-zA-Z0-9]*$`. Use camelCase, never hyphens. Two collection keys must
  differ by more than letter case.
- Every object is strict, so an unknown key is an error. `draft` cannot be a field key.
- Each field needs `type` and `label`. Optional keys are `required` and `hint`, plus the type's own keys:
  - `string`: `list`, `default`
  - `text`: `rows`, `default`
  - `boolean`: `default`, `labels: { true, false }`
  - `select`: `options: [{ label, value }]` (at least one), `multiple`, `default`
  - `number`: `min`, `max`, `step`, `integer`, `default`
  - `datetime`: `dateOnly`, `defaultNow`
  - `color`: `default`
  - `reference`: `collections` (at least one, must exist), `multiple`, `min`, `max` (both need `multiple: true`)
  - `object`: `fields` (nested fields, at least one), `list`, `min`, `max` (both need `list: true`)
  - `blocks`: `blocks: { <kind>: { label, fields } }` (at least one kind), `min`, `max`. `block` cannot be a field
    key inside a block
  - `markdown`, `json`, `url`, `image`: no extra keys
- Nested fields (in `object` and `blocks`) take every type, `object` and `blocks` too, with the same rules. A nested
  `markdown` is a Markdown string; `draft` is an ordinary key there. `object` and `blocks` take no `default`.
- At most one `markdown` field per collection (top level). `titleField` and `slugFrom` must name a field of the collection.
- `label` is the name of one entry (*Post*). `pluralLabel` (optional, not blank, at most 100 characters) is the name
  for many (*Posts*), for the editor's headings; a singleton takes none. Without it the editor shows `label`.
- `url` (optional) is the path of the collection's page on the site, from its root: `/posts/{slug}` (one page per
  entry; `{slug}` is the only placeholder, at most once) or a fixed path where every entry is shown (`/`). A singleton's
  `url` has no `{slug}`. It starts with `/`, is plain ASCII without spaces, `?`, `#`, `\`, `%`, `"`, `<`, `>`, `` ` ``,
  `//` or `.`/`..` segments, at most 200 characters, and not under `/editlet/` or `/__editlet`. Write the slug as
  `{slug}`, never as the route file's `[slug]` or `:slug`: `app/posts/[slug]/page.tsx` → `"url": "/posts/{slug}"`. Keep the site's trailing `/`. Leave it
  out when the collection has no page, or its route depends on a field (`/{category}/{slug}`) or a language prefix.
- `groups` (optional, per collection) splits the editor's entry into tabs: `"groups": { "content": { "label": "Content" },
  "media": { "label": "Media" } }`, in tab order. A top-level field joins one with `"group": "media"`; a field without
  `group` is in the first group. `group` must name a key of `groups` and is not allowed on nested fields. Groups change
  nothing in entry files or types. Add them only when the human asks for tabs or a collection has many fields.
- To add a block kind or a nested field, edit the candidate schema and run `check`: existing entries stay valid as
  long as the new nested field is optional. `rename-field` and `remove-field` work on top-level fields only; for a
  nested field, change the schema and every entry with a candidate + `check`.
- A `default` fills **new** entries only (the editor uses it). It does not fill existing files.

## Choose the procedure

| Change | Procedure |
|---|---|
| Rename a field | `schema.mjs rename-field` ([below](#rename-a-field)) |
| Remove a field | `schema.mjs remove-field` ([below](#remove-a-field)) |
| Add a field, add a collection, change options, labels, `required`, … | Candidate file + `schema.mjs check` ([below](#any-other-change-candidate--check)) |
| Rename a collection | Manual ([below](#rename-a-collection)) |

After any applied change, run `node .claude/skills/editlet/scripts/validate.mjs` and `node .claude/skills/editlet/scripts/types.mjs`. Then tell the human what changed. If a
dev server is running, offer to open `?editlet=schema`.

## Any other change: candidate + check

1. Copy the schema into a candidate file and edit the copy:
   `mkdir -p .editlet && cp cms/schema.json .editlet/schema.next.json`.
2. Run `node .claude/skills/editlet/scripts/schema.mjs check .editlet/schema.next.json` (a relative path is resolved against `--root` when given, else the current folder). It applies the core write rules to the existing content
   and reports only the issues the change would **introduce**, as `file: field — message`. The script prints
   `✓ schema change is safe (N entries checked)` when there are none.
3. Show the human the schema diff (`diff -u cms/schema.json .editlet/schema.next.json`) and the impact.
4. Resolve the impact before you apply:
   - **New required field:** every existing entry needs a value. Ask for the values, or agree to make the field
     optional (`default` does not fill existing entries). Then apply in this order: write the values into the
     entries first, then move the candidate into place. Running `check` again with the values present must pass.
   - **Narrowed options, `min`/`max`, `integer`:** fix the listed entries, or keep the old rule.
5. Apply: `mv .editlet/schema.next.json cms/schema.json`, then validate. If the change is dropped, delete the
   candidate.

**New collection:** add it to the candidate with `label`, `fields`, and usually `titleField` (the field the editor
shows as the entry title) and `slugFrom` (the field slugs are made from). Give a collection with many entries a
`pluralLabel`, and a `url` when the human's site has (or will have) a page for it: read the route that renders it. Create the folder `<contentDir>/<key>/` when
you add the first entry. Git does not track empty folders. Add a reference field elsewhere with `collections: ["<key>"]` if entries
should link to it.

## Rename a field

```bash
node .claude/skills/editlet/scripts/schema.mjs rename-field post featuredImage cover          # dry run: prints the plan
node .claude/skills/editlet/scripts/schema.mjs rename-field post featuredImage cover --apply  # writes it
```

- The dry run lists `cms/schema.json` and every entry that has the field. Nothing is written.
- Apply renames the key in place in the schema, keeping the field order, and updates `titleField` / `slugFrom`.
  It edits only the key line in each entry. If that edit would not read back the same, it rewrites that entry's
  frontmatter in the standard format. Above 12 occurrences of the key in the schema, or when no text edit verifies, the schema file is rewritten in 2-space JSON. The plan marks such entries `(rewritten in standard format)`; `titleField` / `slugFrom` changes are printed as `note:` lines. The whole batch is validated before anything is written.
- Renaming a `markdown` field changes only the schema, because its text is the body.
- The field's `label` stays. If it names the old key ("Featured image"), offer to update it with a candidate + `check`.
- Afterwards, search the site code for the old name: `git grep -n featuredImage -- ':!cms/'`. Code that reads
  `data.featuredImage` must change too. Say so if it is out of your task.

## Remove a field

```bash
node .claude/skills/editlet/scripts/schema.mjs remove-field post subtitle          # dry run
node .claude/skills/editlet/scripts/schema.mjs remove-field post subtitle --apply
```

- The dry run prints a `loses data:` line for each entry that has a value. **Show these lines and get an explicit
  yes before `--apply`.**
- Removing a `markdown` field empties the body of every entry, and the dry run lists them as `loses body:`.
- `titleField` / `slugFrom` that named the field are dropped from the collection.
- Image files that the removed field pointed to stay on disk. Delete them only if the human agrees and no other entry
  uses them.

## Rename a collection

There is no script. The rename touches folders and every reference, so do it in one change set:

1. Edit a candidate: rename the collection key and update every reference field's `collections` that named it.
2. `git mv <contentDir>/<old> <contentDir>/<new>`.
3. Replace `<old>/` with `<new>/` in reference values across `contentDir` (only in reference fields).
4. Move the candidate into place and run `validate`. Image `src` values are relative, so they keep working.
5. Site code that names the collection must change too.

## If the schema on disk is broken

`validate` prints the schema issues with paths like `collections.post.fields.title.type`. Fix `cms/schema.json`
first. Until the schema parses, the editor can save only the schema file.
