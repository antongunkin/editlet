# Editlet admin

The editor UI of Editlet: a static React 19 single-page app.

**Why it exists.** The admin must work with any framework and must never be in the site bundle. So it is a separate
static app. The [loader](../loader/README.md) opens it in an iframe over the site when the URL has `?editlet`. It also runs
on its own in a browser tab.

**What it is.** Vite builds `src/` to `admin/dist/` with `base: './'`, so every asset URL is relative. The Next.js and
Astro adapters serve that folder at `/editlet/`. They find it relative to the package root (Astro from its own
module location, Next.js by resolving `editlet/next/config`), so no import of the admin is needed. In the published
tarball the built admin lives at `dist/admin/dist/`; the package export `editlet/admin/dist/*` points there.

It supports Chrome 125+, Edge 125+, Firefox 126+ and Safari 17.5+ (`browserslist` in the package's `package.json`; the
build targets them, nothing is polyfilled): [browser support](../../../docs/admin/ui.md#browser-support).

It has two modes with the same screens:

- **Dev** (P6): the admin reads and writes files through the local dev file API (`/__editlet`).
- **Production** (P8): the admin signs the editor in with GitHub and edits through the
  [GitHub source](../github/README.md). Every edit is a commit on an `editlet/<name>` branch; the branch screen shows the
  diff against main, a preview link and **Create pull request**. The admin never merges: a developer merges the pull
  request on GitHub.

## How it works

1. The admin calls `GET /__editlet/files`. An answer means dev mode, and the admin uses the local content source.
   Otherwise it reads `config.json` next to itself (written by the adapter: repo, auth URL), signs the editor in, checks
   write access, and uses the GitHub source of the active branch.
2. It reads the schema and the entry files through that source. In dev it polls the file list every 2 seconds.
3. The `?editlet` value picks the screen: home, a collection, one entry, the content model (`schema`), media (`media`),
   or a branch review (`branch:<name>`, production).
4. On an entry, the form shows the fields from the schema. **Save** validates, shows a diff, and commits the entry
   file and any new images in one change.
5. When embedded, the admin talks to the loader with the `postMessage` protocol: it highlights the entry on the page
   and asks the page to refresh after a save.

## Features

| Feature | Doc |
|---|---|
| Mode detection, local content source, `sha` conflict check, polling | [docs/admin/modes-and-source.md](../../../docs/admin/modes-and-source.md) |
| `?editlet` routes, navigation, protocol bridge, unsaved-changes guard | [docs/admin/routing-and-bridge.md](../../../docs/admin/routing-and-bridge.md) |
| Collection list: sortable table (title, updated, by, status), pages, New entry | [docs/admin/collection.md](../../../docs/admin/collection.md) |
| Entry form: values, validation, new entry, draft, delete, conflicts | [docs/admin/entry-form.md](../../../docs/admin/entry-form.md) |
| References: combobox search, Open link, broken references, **Used by**, Rename, delete with the references removed | [docs/admin/entry-form.md](../../../docs/admin/entry-form.md#used-by) |
| `object` and `blocks`: groups, item cards, Add block, move and remove, nested errors and images | [docs/admin/entry-form.md](../../../docs/admin/entry-form.md#widgets) |
| Image fields: upload staging, naming, limits, choose existing (`MediaPicker`) | [docs/admin/images.md](../../../docs/admin/images.md) |
| Media at `?editlet=media`: usage index, upload, replace, alt text across uses, delete unused, SVG cleaning, large uploads | [docs/admin/media.md](../../../docs/admin/media.md) |
| Markdown body: Rich (Milkdown, block splice, raw blocks, toolbar, links, images) and Source | [docs/admin/rich-text.md](../../../docs/admin/rich-text.md) |
| Select to edit: open the entry and select the words from the page (matching, Source and Rich) | [docs/admin/select.md](../../../docs/admin/select.md) |
| Review dialog, what a save commits, commit messages | [docs/admin/review-and-save.md](../../../docs/admin/review-and-save.md) |
| Dev host and the Vite dev server, end-to-end test | [docs/admin/dev-host.md](../../../docs/admin/dev-host.md) |
| Content model at `?editlet=schema`: fields, references, problems, live update, chat prompts | [docs/admin/content-model.md](../../../docs/admin/content-model.md) |
| Components, CSS, tokens, dark and light, narrow side layout | [docs/admin/ui.md](../../../docs/admin/ui.md) |
| Production mode: `config.json`, auth handler hosting, sign-in, token storage and refresh, access check | [docs/admin/production.md](../../../docs/admin/production.md) |
| Branches: active branch, picker, save on main, branch screen, pull request, preview, conflicts | [docs/admin/branches.md](../../../docs/admin/branches.md) |
| Roles: admins and editors through GitHub teams, `CODEOWNERS` and rulesets | [docs/admin/roles.md](../../../docs/admin/roles.md) |
| Every screen and state, the Playwright suite, screenshots and visual regression | [docs/admin/screens.md](../../../docs/admin/screens.md) |
| Using the admin from an agent with a browser: `/editlet/?editlet=…`, roles and names | [docs/admin/agents.md](../../../docs/admin/agents.md) |
| Page preview snapshot: form and branch layers, debounced write, channel, flag, expiry, site refresh; Next preview cookie (Layer B) | [docs/admin/preview.md](../../../docs/admin/preview.md) |

## Commands

Run from the repo root.

| Command | What it does |
|---|---|
| `npm run admin:build -w editlet` | Builds `admin/dist/` |
| `npm run admin:dev -w editlet` | The admin alone with HMR. The dev API runs on a temp copy of the site fixture. |
| `npm run admin:host -w editlet` | A tiny demo site with the loader, the built `dist/` at `/editlet/`, and the dev API. Build first. |
| `npm run admin:host:github -w editlet` | The same demo site and built `dist/` in GitHub mode, against an in-memory fake GitHub (`o/r`), with a fake sign-in popup and fake deployments. Build first. |

| Variable | Used by | Default |
|---|---|---|
| `EDITLET_ROOT` | `admin:dev`, `admin:host` | A fresh temp copy of `node/__fixtures__/site` (the path is printed at start) |
| `PORT` | `admin:host` | `5180` |
| `PORT` | `admin:host:github` | `5181` |

Set `EDITLET_ROOT` to a real project folder to edit its files. Without it, your edits never touch the fixture.

## Tests

```bash
npx vitest run packages/editlet/admin
npm run e2e:admin        # from the repo root: every screen in Chromium, desktop and mobile
npm run screenshots      # the same in light and dark, every screen as a PNG in screenshots/
```

The Playwright suite (`e2e/*.e2e.ts`, config `playwright.config.ts`) starts a dev or GitHub host per test with
`startLocalHost` / `startGitHubHost` on a copy of `examples/astro/cms` ([screens](../../../docs/admin/screens.md)).

Tests run under the root Vitest config (jsdom). Screen tests use `createMemorySource`. `source/local.test.ts` and
`e2e.test.tsx` run against a real `createDevHandler` on a temp copy of the fixture. GitHub-mode tests
(`src/github/*.test.tsx`, including `src/github/e2e.test.tsx`) run the whole `App` against the in-memory fake GitHub
from `github/test/fakeGitHub.ts` (`src/test/fakeGitHub.ts`, `src/test/liveApp.tsx`).

## Files

| Path | Role |
|---|---|
| `src/App.tsx`, `src/Shell.tsx` | Mode pick, providers, header, collection nav, screen switch |
| `src/route.ts`, `src/bridge.ts`, `src/useRoute.ts` | `?editlet` routes, loader protocol, navigation and guard |
| `src/source/` | `detectMode`, `createLocalSource`, `SourceProvider` |
| `src/github/` | Production mode: `GitHubApp`, session and auth, sign-in, workspace (active branch), branch chip and picker, save-on-main field, branch screen, deploy status, error text |
| `config.ts` | `config.json`: `ADMIN_CONFIG_FILE`, `buildAdminConfig` (adapters), `parseAdminConfig` (admin) |
| `src/data/` | TanStack Query hooks over the source; image previews |
| `src/entry/` | Pure entry model: form values, diff rows, issues, image paths |
| `src/screens/` | Home, Collection, Entry, New entry dialog, placeholders, error screens |
| `src/fields/`, `src/ui/`, `src/diff/` | Field widgets, UI primitives, `DiffHunk` and the review dialog |
| `src/preview/` | Page preview snapshot: `PreviewProvider`, `GitHubPreviewSync`, `fieldPreviews`; preview route calls (`previewRoute.ts`) |
| `src/styles.css` | All admin CSS |
| `dev/` | Dev hosts (local and fake GitHub), demo site, dev API middleware, fixture copy |

Design records: `docs/superpowers/specs/2026-11-10-octocms-v2-p6-admin-dev-design.md` (dev mode) and
`docs/superpowers/specs/2026-11-10-octocms-v2-p8-admin-prod-design.md` (production mode).
