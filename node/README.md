# Editlet node

The Node side of Editlet: read and validate a content repo on disk, write generated types, and serve the dev file API.
Import it as `editlet/node`.

**Why it exists.** [`core/`](../core/README.md) has no file access. This module is the thin layer that adds the file
system: scripts and agents use it to check a project, and `npm run dev` of a site uses it so the browser admin can
edit local files. Every rule still comes from `core/`.

**What it is.** Two groups of exports.

```ts
import { readProject, validateProject, writeTypes, createDevHandler } from 'editlet/node';
```

| Export | Purpose |
|---|---|
| `readProject(root, schemaPath?)` | Load schema and entries |
| `validateProject(root, schemaPath?)` | All issues of a repo |
| `writeTypes(root, outFile?, schemaPath?)` | Write the generated `.d.ts` |
| `createDevHandler({ root, schemaPath?, allowedHosts? })` | `(Request) => Promise<Response>` for the dev API |

`schemaPath` defaults to `cms/schema.json`, relative to `root`.

## Features

| Feature | Doc |
|---|---|
| Reading and validating a repo, writing types, the skill scripts | [docs/project.md](../../../docs/node/project.md) |
| Dev file API: routes (files, commit, git with the uncommitted files and the project id, history of one file or of up to 500 at once, file versions), statuses, `If-Match`, security | [docs/dev-api.md](../../../docs/node/dev-api.md) |

## Scripts

From the repo root (they run `packages/editlet/skills/editlet/scripts/*.ts` with `jiti`):

| Command | Does |
|---|---|
| `npm run editlet:validate -- <root>` | Prints one issue per line to stderr and exits with 1, or prints `✓ N entries valid` |
| `npm run editlet:types -- <root>` | Writes `<root>/.editlet/content.d.ts` and prints its path |

`<root>` defaults to the current directory. Details in [docs/project.md](../../../docs/node/project.md#scripts).

## Files

| File | Role |
|---|---|
| `project.ts` | `readProject`, `validateProject`, `writeTypes` |
| `fs.ts` | Internal: schema loader and content-directory walker (not exported) |
| `devHandler.ts` | `createDevHandler` |
| `history.ts` | Internal: the `git log` reads of the history routes, one file and a batch |
| `index.ts` | Barrel: `project.ts` and `createDevHandler` |
| `__fixtures__/` | `site` (valid) and `broken` repos used by tests |
