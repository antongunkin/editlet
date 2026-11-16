# Editlet core

The schema, entry file format, validation, type generation and write rules of Editlet. Import it as
`editlet/core`.

**Why it exists.** The admin runs in the browser, and the same rules must hold in the browser, in Node scripts and in
every content source (local dev API, GitHub). So the rules live in one module with no Node APIs: the files use only
Web standards (`TextDecoder`, `crypto.subtle`, `URL`). Dependencies: `yaml` and `zod`.

**What it is.** Pure functions and types. It reads no files and makes no network calls. Reading a repo is
[`node/`](../node/README.md); everything else that touches storage goes through the `ContentSource` interface.

## Content model in one minute

- `cms/schema.json` lists collections and their fields.
- An entry is one `.md` file: YAML frontmatter for the fields, the Markdown body for the one `markdown` field.
- Entries live at `<contentDir>/<collection>/<slug>.md`; a singleton is `<contentDir>/<collection>/index.md`.
- References are `collection/slug`. Images are paths inside `contentDir`.

```ts
import { loadSchema, parseEntryFile, validateEntry } from 'editlet/core';

const schema = loadSchema(JSON.parse(schemaText)); // throws EditletError
const { data, body } = parseEntryFile(fileText);
const issues = validateEntry(schema, { collection: 'post', slug: 'hello', data, body });
```

## Features

| Feature | Doc |
|---|---|
| Schema: field types and the rules `loadSchema` enforces | [docs/schema.md](../../../docs/core/schema.md) |
| Entry files: frontmatter, YAML rules, paths, slugs, references | [docs/entry-files.md](../../../docs/core/entry-files.md) |
| Validation: `validateEntry`, `normalizeData`, `initialData`, the "absent" rule | [docs/validation.md](../../../docs/core/validation.md) |
| JSON Schema and `.d.ts` generation | [docs/generation.md](../../../docs/core/generation.md) |
| Write rules and batch integrity: `validateChanges`, `validateCommit` | [docs/writes.md](../../../docs/core/writes.md) |
| `ContentSource`, the memory source, the error contract, `gitBlobSha` | [docs/content-source.md](../../../docs/core/content-source.md) |
| Image references in fields and body, in-place alt and `src` edits | [docs/assets.md](../../../docs/core/assets.md) |
| References between entries: referrers, resolving several levels deep, the `Resolved` type | [docs/references.md](../../../docs/core/references.md) |
| Rename an entry's slug or delete it, with references and images rewritten in one change | [docs/rename.md](../../../docs/core/rename.md) |
| Git style: branch prefix, commit messages and trailer, pull request title and body | [docs/git-style.md](../../../docs/core/git-style.md) |

## Errors

Everything that can be fixed by the user is an `Issue` (`{ file?, path, message }`). `loadSchema`, `parseEntryFile`
and similar functions throw `EditletError`, which carries `issues`. `validate*` functions return `Issue[]` and do not
throw for bad content.

## Files

| File | Role |
|---|---|
| `schema.ts` | Types and `loadSchema` / `parseSchemaText` |
| `fields.ts` | Zod schema per field type, the "absent" rule |
| `entryFile.ts` | Parse and write `.md` + frontmatter, `decodeUtf8` |
| `paths.ts` | Entry paths, slugs, ref keys, asset resolution |
| `assets.ts` | `findBodyImages`, `findImageRefs`, `editBodyImages` |
| `references.ts` | `referenceFields`, `entryReferences`, `findReferrers`, `createResolver`, `Resolved` |
| `rename.ts` | `planRename`, `planRemove`: the file changes of a slug rename and of a delete with references removed |
| `walk.ts` | `visitFields`, `mapFields`, `blockFields`, `allFields`: data with its fields, into `object` and `blocks` |
| `gitStyle.ts` | `resolveGitStyle`, `isEditletBranchName`, commit subjects and messages, pull request title and body |
| `validate.ts` | `validateEntry`, `buildDataSchema`, `normalizeData`, `initialData` |
| `generate.ts` | `toJsonSchema`, `generateTypes` |
| `writes.ts` | `isWritablePath`, `validateChanges`, `validateCommit` |
| `source.ts` | `ContentSource`, `createMemorySource` |
| `sha.ts` | `gitBlobSha` |
| `devApi.ts` | Types and constants of the dev file API ([node dev API](../../../docs/node/dev-api.md)) |
| `issues.ts` | `Issue`, `EditletError` |
| `index.ts` | Barrel: re-exports everything above |
