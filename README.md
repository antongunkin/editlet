# Editlet

A Git-based, file-based CMS for Next.js and Astro. Content is Markdown files with YAML frontmatter in your repo,
described by one `cms/schema.json`. Editors open `?editlet` on any page of the site, and every edit becomes a commit.
Claude Code is the main editor, through the bundled skill.

Status: alpha (the npm dist-tag `alpha`: `editlet@alpha`). Node 22.12 or newer. Browsers: Chrome 125+, Edge 125+,
Firefox 126+, Safari 17.5+. License: MIT.

## Install with your agent

Copy this prompt into Claude Code, Codex or another coding agent, in your Next.js or Astro project:

```text
Install Editlet in this project: add the package `editlet@alpha` with the project's package manager, then read
node_modules/editlet/skills/editlet-setup/SKILL.md and follow it.
```

## Install manually

```bash
npm install editlet@alpha
node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks
```

`link.mjs --hooks` links the skill into `.claude/skills/editlet` and `.agents/skills/editlet` and adds the guard hook.
Run it again any time; with `--check --hooks` it only reports. Then add `cms/schema.json` and wire the framework as shown below
(the agent's version of these steps is the `editlet-setup` skill in `skills/editlet-setup/`).

`next`, `react` and `astro` are optional peer dependencies. Install the ones your framework needs: `next >=16` with
`react >=19`, or `astro ^6 || ^7`.

## Entry points

| Import | What it is |
|---|---|
| `editlet/next` | `createReader`, `EditletLoader` for Next.js Server Components |
| `editlet/next/config` | `withEditlet` wrapper for `next.config.ts` |
| `editlet/next/preview` | Draft-mode preview route (`POST`/`DELETE`) for `app/api/editlet/preview/route.ts` |
| `editlet/astro` | Astro integration |
| `editlet/astro/content` | `editletCollections`, `editletLoader` for `src/content.config.ts` |
| `editlet/core` | Schema, entry parsing, validation, type generation (no Node or framework APIs) |
| `editlet/node` | Local project reading and the dev file API |
| `editlet/github` | GitHub content source: tree reads, commits, branches, PRs |
| `editlet/auth` | GitHub OAuth handler (Cloudflare, Vercel, Node) |
| `editlet/auth/client` | Browser side of the sign-in flow |
| `editlet/auth/protocol` | Shared auth constants and types |
| `editlet/loader` | The `?editlet` loader that mounts the editor iframe on a page |
| `editlet/loader/protocol` | The `postMessage` protocol between page and admin |
| `editlet/admin/dist/*` | The prebuilt admin app (static files) |

## Next.js

```ts
// next.config.ts
import { withEditlet } from 'editlet/next/config';
export default withEditlet({ reactStrictMode: true });
```

```ts
// src/lib/cms.ts
import { createReader } from 'editlet/next';
import type { EntryMap } from '../../.editlet/content';
export const { getEntries, getEntry, getRef } = createReader<EntryMap>();
```

```tsx
// app/layout.tsx: render <EditletLoader /> after {children}
import { EditletLoader } from 'editlet/next';
```

Add `/.editlet/` and `/public/editlet/` to `.gitignore`. More in the Next.js adapter README (`next/README.md` in the
repository).

## Astro

```js
// astro.config.mjs
import editlet from 'editlet/astro';
import { defineConfig } from 'astro/config';
export default defineConfig({ integrations: [editlet()] });
```

```ts
// src/content.config.ts
import { editletCollections } from 'editlet/astro/content';
export const collections = editletCollections();
```

Then use `getCollection`, `getEntry` and `render` as usual. More in the Astro adapter README (`astro/README.md`).

## Agent skills

The package ships three Agent Skills in `skills/`:

| Skill | Use |
|---|---|
| `editlet` | Edit content and the schema, preview in `?editlet`, publish through an `editlet/<name>` branch and a PR |
| `editlet-setup` | Install Editlet in Next.js or Astro, set up editing on the live site, upgrade, diagnose (`doctor.mjs`) |
| `editlet-migrate` | Import Markdown/MDX folders, Astro collections, Decap, TinaCMS, Keystatic and similar |

```bash
node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks
```

This links all three into `.claude/skills/` and `.agents/skills/` and adds the guard hook. Then ask your agent to set
up Editlet. Check content with `node node_modules/editlet/skills/editlet/scripts/validate.mjs`. More in
`skills/README.md`.

## Documentation

The package source is published in [antongunkin/editlet](https://github.com/antongunkin/editlet).
The full docs live in the development repository under `docs/`, which is not exported there yet, so module READMEs
that link to `docs/` have dead links in the public repo. There is no public docs URL yet.
