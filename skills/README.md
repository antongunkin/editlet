# Editlet skills

The Agent Skills that let a person run an Editlet site from a chat with Claude Code, Codex or another agent. They ship
in `editlet` as `skills/<name>/`, so they always match the installed version of the package.

**Why they exist.** In Editlet, people edit content in an agent chat, not mainly in a form, and there is no CLI. The
skills give the agent the exact content format, safe schema changes, validation before every commit, a preview in the
`?editlet` editor, a publish flow that waits for the human's approval, the framework and production setup, and a safe
migration from other CMS.

| Skill | For | Covers |
|---|---|---|
| [`editlet`](editlet/SKILL.md) | Anyone editing content | Entries, images, the schema (dry runs), `?editlet` preview, publishing through an `editlet/<name>` branch and a PR |
| [`editlet-setup`](editlet-setup/SKILL.md) | The site's developer | Installing in Next.js or Astro, editing on the live site (auth handler, GitHub App, env, branch protection, draft preview), upgrades, `doctor` |
| [`editlet-migrate`](editlet-migrate/SKILL.md) | The developer, once per source | Importing Markdown/MDX folders, Astro collections, Decap, TinaCMS, Keystatic, Contentlayer, Front Matter CMS |

Each skill is a `SKILL.md` (short rules and workflow) plus `references/` (details, loaded on demand) and, where
needed, `scripts/` (plain Node). They follow the open [Agent Skills](https://agentskills.io) format; the frontmatter
has only `name` and `description`.

## Install

Give the agent this prompt in the project:

```text
Install Editlet in this project: add the package `editlet` with the project's package manager, then read
node_modules/editlet/skills/editlet-setup/SKILL.md and follow it.
```

By hand:

```bash
npm install editlet
node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks
```

`link.mjs --hooks` links every skill into `.claude/skills/<name>` and `.agents/skills/<name>` and adds the guard hook
to `.claude/settings.json`. Details: [editlet-setup/references/skills.md](editlet-setup/references/skills.md).

## Scripts

Run them with `node <skill folder>/scripts/<name>.mjs` from the project root. The `.mjs` files are bundles built from
the `.ts` sources next to them.

| Script | Does |
|---|---|
| `editlet/scripts/validate.mjs [root]` | Checks the schema and every entry. Prints `✓ N entries valid`, or one issue per line and exits with 1 |
| `editlet/scripts/types.mjs [root]` | Writes `.editlet/content.d.ts` |
| `editlet/scripts/schema.mjs check <candidate.json>` | Shows how a candidate schema affects existing entries; writes nothing |
| `editlet/scripts/schema.mjs rename-field <c> <from> <to> [--apply]` | Renames a field in the schema and in all entries (dry run by default) |
| `editlet/scripts/schema.mjs remove-field <c> <field> [--apply]` | Removes a field and lists the data that would be lost (dry run by default) |
| `editlet/scripts/schema.mjs json-schema [c]` | Prints the JSON Schema of the frontmatter |
| `editlet/scripts/refs.mjs used-by \| rename \| remove <collection/slug> … [--apply]` | Who references an entry; renames it or deletes it with every reference rewritten (dry run by default) |
| `editlet/scripts/guard.mjs` | PreToolUse hook: blocks pushes to the base branch, `--admin` merges and invalid commits; asks before a merge |
| `editlet/scripts/link.mjs [--check] [--hooks]` | Links all skills and adds the hook (idempotent); removes links to skills that are gone |
| `editlet-setup/scripts/doctor.mjs [--url <site>] [--json]` | Read-only checks of the project, the live site, the auth handler and GitHub |

Exit codes: `1` for content, schema or setup issues, `2` for usage errors.

## Features

| Feature | Doc |
|---|---|
| The set: which skill does what, how they are installed | [docs/skill/skill.md](../../../docs/skill/skill.md) |
| `editlet-setup`: install, the live site, upgrades | [docs/skill/setup.md](../../../docs/skill/setup.md) |
| `doctor.mjs`: every check and what it proves | [docs/skill/doctor.md](../../../docs/skill/doctor.md) |
| `editlet-migrate`: rules, mapping, limits | [docs/skill/migrate.md](../../../docs/skill/migrate.md) |
| Schema changes: impact check, rename and remove with a dry run | [docs/skill/schema-changes.md](../../../docs/skill/schema-changes.md) |
| The guard hook: decisions, parsing, limits | [docs/skill/guard.md](../../../docs/skill/guard.md) |
| Linking: links, the hook, stale links, monorepos | [docs/skill/install.md](../../../docs/skill/install.md) |
| Packaging: why the scripts are bundled | [docs/skill/packaging.md](../../../docs/skill/packaging.md) |
| Evaluation: the harness, baselines and results | [docs/skill/eval.md](../../../docs/skill/eval.md) |

## Development

```bash
node packages/editlet/skills/editlet/scripts/build.ts   # bundles each skill's scripts/*.ts → *.mjs (git-ignored)
npx vitest run packages/editlet/skills
node benchmarks/skills/run.mjs <case> --tarball <editlet.tgz> --out <dir>   # agent evals, by hand
```

Tests import entry scripts with an explicit `.ts` extension, because a stale `.mjs` bundle next to them would
otherwise resolve first. The agent evals live outside the package, in `benchmarks/skills/`; see
[docs/skill/eval.md](../../../docs/skill/eval.md).
