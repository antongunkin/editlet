# Doctor: checks and fixes

```bash
node .claude/skills/editlet-setup/scripts/doctor.mjs [--root <dir>] [--url <https://site>] [--json]
```

It only reads: files, `git`, `gh api` GETs, `vercel env ls` names, and HTTP GETs to `--url` and its auth handler. It
never prints an env value. One line per check: `ok`, `warn`, `fail` or `manual` (check by hand), then `<id>:` and a
message. Exit 1 when any line is `fail`.

Fix every `fail`, explain every `warn`, run it again. For a fix that changes something outside the repo, ask first.

## Project

| Id | Meaning | Fix |
|---|---|---|
| `project.node` | Node is older than 22.12 | Tell the human to upgrade Node (`.nvmrc`, the host's Node setting) |
| `project.package` | `editlet` is not in `node_modules` | Install it with the project's package manager |
| `project.framework` | No Next or Astro config, or versions outside `next >=16` + `react >=19` / `astro ^6 \|\| ^7` | Upgrade the framework, or stop: Editlet does not support it |
| `project.skills` | Skill links or the guard hook are missing, point elsewhere, or the guard cannot load | `node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks`; `guard broken` after a fresh clone means `npm install` first |
| `content.valid` | The schema or an entry fails validation | Follow the `editlet` skill: fix the files, run `validate.mjs` |
| `content.urls` | `ok`: which collections have a page address (`url`) and which have none. `warn`: no collection has one, but the site has a dynamic route (`app/**/[slug]/page.*`, `src/app/**/[slug]/page.*`, `src/pages/**/[slug].astro`) | Add `url` to the collections that have pages ([next § page addresses](next.md#page-addresses-and-plural-labels)); a collection without a page needs none |

## Next.js

| Id | Meaning | Fix |
|---|---|---|
| `next.config` | The export is not wrapped in `withEditlet`: no admin, no types, no dev API | [next § 1](next.md#1-config) |
| `next.loader` | The root layout does not render `<EditletLoader />`: `?editlet` does nothing | [next § 3](next.md#3-the-loader-in-the-root-layout) |
| `next.gitignore` | `/.editlet/` or `/public/editlet/` is not ignored: generated files get committed | Append the lines |
| `next.preview-route` | `admin.preview` is on but the route is missing | [preview § 2](preview.md#2-the-route) |
| `next.coop` | `headers()` sends `Cross-Origin-Opener-Policy: same-origin`: the sign-in popup breaks | Remove it or use `same-origin-allow-popups`; ask if it was added on purpose |
| `admin.auth-url` | `warn`: no `authUrl`, editors can sign in only with a token. `ok` shows the URL | [production § 2](production.md#2-the-admin-options), only if the human wants GitHub sign-in |
| `admin.auth-route` | `authUrl` points into this app but no route imports `editlet/auth` | [production § 1](production.md#1-choose-where-the-auth-handler-runs) |

## Astro

| Id | Meaning | Fix |
|---|---|---|
| `astro.integration` | `editlet()` is not in `integrations` | [astro § 1](astro.md#1-integration) |
| `astro.collections` | `src/content.config.ts` does not use `editletCollections` / `editletLoader` | [astro § 2](astro.md#2-collections) |
| `astro.base` | Astro `base` is set; Editlet does not support it | Tell the human; there is no workaround yet |

## Environment

| Id | Meaning | Fix |
|---|---|---|
| `env.example` | `.env.example` lacks names the setup needs | Add the names with empty values ([production § 3](production.md#3-environment-variables)) |
| `env.ignored` | `.env`, `.env.local` or `.env.production` exists and is not git-ignored | Add it to `.gitignore`; if it was ever committed, tell the human to rotate the secrets in it |
| `env.vercel` | The linked Vercel project lacks names (`fail`), or `vercel` could not list them (`manual`) | The human adds them in Vercel; `vercel env add <NAME> production` only after a yes, with the human typing the value |

## Live site (`--url`)

| Id | Meaning | Fix |
|---|---|---|
| `site.config` | `/editlet/config.json` is missing or has no repository: the editor says "Editing on the live site is not set up" | Set `admin.repo`, or deploy on Vercel / Actions where it is read from the env; redeploy |
| `site.admin` | `/editlet/index.html` is not served | Next: `withEditlet` and `/public/editlet/` in the build; Astro: the integration; check the host does not rewrite `/editlet/*` |
| `site.dev-api` | **`/__editlet/files` answers 200 on the live site: anyone can write files.** | Take the deploy down or block the path now; the site must run `next start` / a static build, never `next dev` / `astro dev` |
| `site.coop` | The page sends COOP `same-origin` | [production § 6](production.md#6-headers) |
| `site.entry-url` | The first collection whose `url` has `{slug}`: its first entry by file name that is not a draft, fetched on the live site. `ok` for a redirect that only adds or drops the trailing `/`; `warn`: any other non-2xx (the answer, a redirect's target); `manual`: the collection has only drafts. No such collection: no line | Compare the pattern with the site's route and its trailing `/`; fix `url` (a redirect to the same path with or without `/` is only `ok` with a note: write the slash the site uses) |
| `site.preview` | `manual`: draft preview is on | Open `?editlet` on an Editlet branch (`editlet/*`, or `git.branchPrefix`) and check the page shows branch content |
| `auth.url` | `config.json` has no `authUrl` | As `admin.auth-url` |
| `auth.health` | `<authUrl>/health` does not answer 204: the handler is not deployed at that URL | Deploy the handler; check the path (`/api/editlet/oauth`) |
| `auth.origin` | `/auth?origin=<site>` does not redirect to GitHub: `ALLOWED_ORIGINS` lacks the site origin (400), or `GITHUB_CLIENT_ID` is empty | Fix the variable in the host and redeploy |
| `auth.github-app` | `manual`: what the GitHub App must have | Compare with [production § 4](production.md#4-the-github-app-the-human-creates-it) |

## GitHub (with `--url`, or when the config has `admin`)

| Id | Meaning | Fix |
|---|---|---|
| `github.repo` | No repository found, `gh` not logged in (`manual`), no access (`fail`), or you cannot push (`warn`) | `gh auth login` is the human's step |
| `github.protection` | The base branch has no rule that requires a pull request | [production § 5](production.md#5-protect-the-base-branch) |
| `github.deployments` | No non-production deployments: the branch screen shows no preview | Normal on Netlify and Cloudflare Pages; on Vercel, check the GitHub integration |
| `github.labels` | A label of `git.pullRequest.labels` (default `editlet`) does not exist in the repo | `gh label create <name>` after a yes, or `"labels": []` in the schema |
| `github.roles` | `manual`: no `CODEOWNERS` on the base branch, so the admins-and-editors recipe is not in use | Only if the human wants roles: [roles](roles.md) |
| `github.codeowners` | `fail`: GitHub reports syntax errors in `CODEOWNERS` (line and message). `ok` names who owns content and the schema | [roles § 3](roles.md#3-githubcodeowners) |
| `github.code-owner-review` | The base ruleset does not require Code Owners review or approval of the last push, so `CODEOWNERS` is not enforced | [roles § 4](roles.md#4-ruleset-on-the-base-branch) |
| `github.creations` | `warn`: anyone with write access may create any branch. `fail`: a creation rule also covers `<prefix>*`, so the editor cannot create branches | [roles § 5](roles.md#5-who-may-create-branches-and-who-may-touch-code): exclude `<prefix>**/*` |
| `github.push-rules` | `warn`: no push rule restricts the schema and code. `manual` on a public repo (push rules need private or internal) | [roles § 5](roles.md#5-who-may-create-branches-and-who-may-touch-code) |
| `github.bypass` | `manual`: GitHub hides the bypass list from this account | The human checks that only admins bypass the push ruleset |

## Symptoms without `--url`

| The human says | Check first |
|---|---|
| "`?editlet` does nothing" | `next.loader` / `astro.integration`; the browser console |
| "Editing on the live site is not set up" | `site.config` |
| "The sign-in popup closes / fails" | `auth.origin`, `site.coop`, the GitHub App callback URL; `state_mismatch` on `http://localhost` in Safari |
| "Save fails: changed on GitHub" | A conflict, not a setup problem: reload in the editor |
| "No preview on the branch screen" | `github.deployments` |
| "Open on the page gives a 404" | `site.entry-url`; the collection's `url` against its route |
| "Draft preview shows the old page" | `next.preview-route`, the two env names, `{ ref }` on every read ([preview § 4](preview.md#4-pages-read-the-preview-ref)) |
