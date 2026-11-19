# Preview in the `?editlet` editor

The editor opens over any page of the site when the URL has `?editlet`. In dev it reads and writes the local files
through the dev server. A site may use another parameter name: `EDITLET_PARAM` in `.env*` or the host's env, or
`admin.param` in `next.config.*` / `astro.config.*`. Then use that name everywhere below (`?cms=post/spring-sale`). Use it to **show** the human your changes. Make your edits in the files, not by driving the
editor's form, unless the human asks you to.

## Is a dev server running?

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/__editlet/files
```

- `200`: a dev server with the Editlet adapter is running on that port. Try the project's usual port first (Next
  `3000`, Astro `4321`, or what `package.json` / the dev script says).
- `403` or `500`: a server runs there, but the request was refused (`403`: host not allowed) or the schema is
  broken (`500`, the body lists the issues). Do not start a second server; fix the schema or use `localhost`.
- `404`, another code, or a refused connection: no Editlet dev server. To start one, use the dev script (`npm run dev`)
  in the background, or the host's preview tool. Wait until the check returns `200`. If the human did not ask for a
  preview, just tell them how to start one.

## Open the right screen

URL: `http://localhost:<port><page>?editlet=<route>`. Use the page where the content appears. Keep any existing query
parameters.

- **The collection has `url`** in `cms/schema.json`: that is its page. Put the slug in for `{slug}`:
  `"url": "/blog/{slug}"` → `http://localhost:3000/blog/spring-sale?editlet=post/spring-sale`. A `url` without
  `{slug}` (`/`, `/blog`) is the one page that shows every entry of the collection, or the singleton.
- **No `url`**: the collection has no page of its own (settings, authors shown inside posts), or its route is one `url`
  cannot describe (`/[year]/[slug]`, a locale prefix). Use the page you know shows it, else `/`.
- A draft may have no page on the live site; `next dev` and `astro dev` usually show it (a site that filters drafts
  itself does not).

| Route | Screen |
|---|---|
| `?editlet` | Editor home: collections and entries |
| `?editlet=<collection>/<slug>` | One entry, e.g. `?editlet=post/spring-sale`. A singleton: `?editlet=homePage/index` |
| `?editlet=schema` | The content model, the screen to show after a schema change |
| `?editlet=media` | Media: every image, where it is used, upload, alt text, delete unused |
| `?editlet=branch:<name>` | Preview of branch `<prefix><name>` (`git.branchPrefix`, default `editlet/`) with its diff ([publishing](publishing.md)) |

Write the route readably: `?editlet=post/spring-sale`, not `%2F`.

**Browser tools.** In the Claude desktop app, use the built-in browser (`preview_start` with the URL, or
`navigate`). Use Claude in Chrome (`mcp__claude-in-chrome__*`) only when the human asks for it or the built-in
browser is not available. Take one screenshot or read the page to confirm the screen opened, then hand over to the
human. Without browser tools, print the URL.

## Driving the editor yourself

Only when the human asks you to use the editor (or to check what it shows). Open the admin as its own page,
`http://localhost:<port>/editlet/?editlet=<route>`: the same editor, with every control in the page's accessibility tree
(the `?editlet` window lives in an iframe that some browser tools do not read). Act by role and name, never by
coordinates:

- A field is named by its schema `label` (`textbox "Title"`, `combobox "Category"`); required fields have
  `aria-required`.
- `button "Save 1 change"` opens `dialog "Your changes"`; the entry's row opens its diff (`dialog "<title>"`, one
  region per changed field with the old and new value; inline in a 600 px window). Confirm with the CTA inside
  `Your changes` (`Save 1 change`). Then check the file with `git diff`.
- The status line at the bottom of each screen says `Unsaved changes (n)` (a button that opens the review),
  `n uncommitted` or `Draft`; GitHub mode has `button "Branch <name> …"` there.
- Escape closes a menu or dialog first, then collapses the window; errors are text in the page.

The full map of roles and names is `docs/admin/agents.md` in the Editlet repository.

## After you edit

- The dev server picks up file changes. If an entry screen is already open, navigate to the same URL again so the
  editor reloads the file.
- If the editor shows an error, run `validate` and fix the file. The editor refuses invalid content just like the
  script does.

## When the human edits in the editor

- A save in the editor writes the file on disk, and in dev it is not committed. Before your next edit, run
  `git status` / `git diff` and re-read the file. Build on their version, and never write back a stale copy.
- If you and the human changed the same field differently, ask which one wins.

## Dev versus publishing

Editing locally changes nothing on the live site. To put the changes live, follow [publishing](publishing.md): a
`editlet/<name>` branch (the schema's prefix), a PR, approval, then the merge. Commit in dev only when the human asks. Then still use a branch,
never the base branch.
