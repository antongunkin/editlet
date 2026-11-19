---
name: editlet-setup
description: >-
  Use when adding Editlet to a Next.js or Astro project, upgrading the editlet package, setting up editing on the live
  site (GitHub sign-in, the auth handler, GitHub App, environment variables, Vercel, branch protection, draft preview),
  splitting admins and editors (GitHub teams, CODEOWNERS, rulesets), or when ?editlet, the GitHub sign-in, the branch
  preview or the draft preview does not work. Typical asks: "install Editlet", "add a CMS to this site", "set up the
  editor on production", "copywriters should only change content", "the sign-in popup fails", "?editlet says editing on
  the live site is not set up", "upgrade Editlet".
---

# Editlet setup

You set up Editlet for the site's developer: the package, the framework wiring, the skills, and editing on the live
site. Content editing itself is the `editlet` skill; importing existing content is `editlet-migrate`.

Editlet in one paragraph: content is `.md` files under `cms/content`, described by `cms/schema.json`. `?editlet` on any
page opens an editor over the site. In `next dev` / `astro dev` it edits local files through `/__editlet`. On the live
site it signs in with GitHub (an auth handler + a GitHub App), commits to `editlet/<name>` branches and opens pull requests;
a merge publishes.

The public docs are at https://editlet.gunkin.dev/docs. For a question this skill and its references do not answer,
read https://editlet.gunkin.dev/llms.txt (an index of the docs as Markdown, `/docs/<page>.md`). Do not fetch them for a
normal install: everything it needs is here.

## Rules

1. **MUST look before you write:** the framework and its version (`next >=16` with `react >=19`, or
   `astro ^6 || ^7`), the package manager (lockfile), `src/` or not, `AGENTS.md` / `CLAUDE.md` rules of the project, and
   any existing content (Markdown, MDX, `content/`, `posts/`) or CMS config (`public/admin/config.yml`, `tina/`,
   `keystatic.config.ts`). **If content exists, NEVER copy, move or convert it during setup**: finish the wiring, then
   offer `editlet-migrate`.
2. **MUST say which files you will create or change before the first write, and change them minimally:** wrap the
   existing config, add one line to the layout, append to `.gitignore`. NEVER replace an existing file, and add
   nothing the task did not ask for (no preview route, auth route or pages unless asked).
3. **NEVER write a secret value into any file, and never print one.** `.env.example` gets names with empty values.
   The human sets values in the host. Doctor and you read names, never values.
4. **MUST ask before any command that changes something outside the repo:** `vercel env add`, `vercel deploy`,
   `gh api` with a write method, rulesets, `wrangler deploy` or `secret put`. Creating the GitHub App is the human's
   step; you give the exact values.
5. **MUST prove it works by running it:** `validate.mjs` ✓, the project's build passes, and a dev server you start
   answers `200` on `/__editlet/files` and `/editlet/index.html`. Stop the server afterwards. For the live site:
   `doctor.mjs --url` after the deploy. Say plainly what you did not check.
6. **Setup changes are code.** Leave them uncommitted for the developer to review. If asked to commit: a feature
   branch (`setup/editlet`) and a PR, never the base branch and never an `editlet/*` branch (those are content
   change sets).
7. **NEVER weaken the guard hook, branch protection or the dev-API build guard** to make something work.

## Scripts

| Command | What it does |
|---|---|
| `node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks` | Links all Editlet skills into `.claude/skills` and `.agents/skills`, adds the guard hook. `--check` only reports |
| `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs [--url <https://site>]` | Read-only checks of the project, and with `--url` of the live site, the auth handler and GitHub |
| `node .claude/skills/editlet/scripts/validate.mjs` | Checks the schema and every entry |
| `node .claude/skills/editlet/scripts/types.mjs` | Writes `.editlet/content.d.ts` (Next.js) |

## Install

1. **Look** (rule 1). Read `package.json`, the framework config, the root layout or `src/content.config.*`,
   `.gitignore`, and list content folders.
2. **Plan.** Name the files (rule 2). If a schema or content already exists, say what you will leave alone.
3. **Package.** Install `editlet` with the project's package manager (`npm install`, `pnpm add`, `yarn add`,
   `bun add`).
4. **Skills.** `node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks` ([skills](references/skills.md)).
5. **Framework.** [Next.js](references/next.md) or [Astro](references/astro.md), steps 1–4 there: config, `.gitignore`,
   loader or collections, and a minimal schema with one sample entry only if no content exists. Then give each
   collection that is not a singleton its `pluralLabel`, and each collection that has a page its `url` (read from the
   site's routes); ask the human for a collection you cannot map
   ([next § page addresses](references/next.md#page-addresses-and-plural-labels)).
6. **Verify** (rule 5), the reference's last step.
7. **Hand over:** the files changed, the `?editlet` URL, what is not set up yet (the live site), and, if content exists,
   the offer to migrate it with `editlet-migrate`.

## Editing on the live site

Do it only when asked. Follow [production](references/production.md): choose where the auth handler runs, add its
route or deploy files, set `admin.authUrl` (and `admin.repo` off Vercel), write the env names to `.env.example`, give
the GitHub App values, and tell the human to protect the base branch with a ruleset (this is required, not optional:
an editor's token can merge). End with the checklist of what the human does. Draft preview (Next.js): [preview](references/preview.md).

## Roles: admins and editors

Do it only when asked ("editors should change only content", "set up roles", "copywriters must not touch code").
Follow [roles](references/roles.md): look up the account, plan and teams, ask who approves content, write
`.github/CODEOWNERS` (code: rule 6), then prepare the rulesets as `gh api` commands and run each only after a yes
(rule 4). Editlet has no roles of its own; GitHub enforces them.

## Upgrade

[skills § Upgrade](references/skills.md#upgrade): install the new version, run `link.mjs --hooks`, `validate.mjs`, the
build.

## Something does not work

Run `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs`, with `--url <live site>` for a production problem. Fix each `fail`
with [doctor](references/doctor.md), which also maps symptoms ("the popup fails") to checks. Run it again until it has
no `fail`.

## Common mistakes

| Mistake | Instead |
|---|---|
| Copying existing posts into `cms/content` during setup | Leave them; offer `editlet-migrate` |
| "Build passes" as the only proof | Also the dev server checks and `?editlet` |
| A preview or auth route nobody asked for | Only what the task needs |
| A guessed `url`, or a new route so a collection has one | `url` only from a route that exists; otherwise leave it out or ask |
| No `authUrl`, hoping the editor asks for it | `admin.authUrl` in the config |
| GitHub App without Deployments: Read | Contents RW, Pull requests RW, Deployments R |
| Branch protection as "optional" | Required: a ruleset that requires a PR |
| Roles in the editor or the config | GitHub teams, `CODEOWNERS` and rulesets ([roles](references/roles.md)) |
| Committing setup on `main` or an `editlet/*` branch | Uncommitted, or `setup/editlet` + PR |
