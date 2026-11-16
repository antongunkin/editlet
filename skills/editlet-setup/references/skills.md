# The skills, the guard hook, upgrades

Read this to link or check the skills, to explain the guard hook, in a monorepo, for an upgrade, or when a script is
missing.

## Link the skills

The skills ship inside the npm package, in `node_modules/editlet/skills/<name>`. Link them so they always match the
installed version:

```bash
node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks
```

It creates relative symlinks for every skill of the package and adds the guard hook:

| Path | For |
|---|---|
| `.claude/skills/<name>` → `../../node_modules/editlet/skills/<name>` (`editlet`, `editlet-migrate`, `editlet-setup`) | Claude Code |
| `.agents/skills/<name>` → the same | Other agents that read `.agents/skills` (Codex and others) |
| `.claude/settings.json` → a `PreToolUse` hook on `Bash` running `editlet/scripts/guard.mjs` | The git/gh safety net |

A link that points at a skill the installed version no longer has is reported as `stale link` and removed.

Run it again at any time; it is idempotent. `--check` only reports and exits 1 when something is missing, points elsewhere (`wrong link`), or, with `--hooks`, when the guard is missing or cannot load. A real
directory (a copy) at a link path is left alone and reported. Without `--hooks`, no settings are written.

By hand, from the project root:

```bash
mkdir -p .claude/skills .agents/skills
for s in editlet editlet-setup editlet-migrate; do
  ln -s ../../node_modules/editlet/skills/$s .claude/skills/$s
  ln -s ../../node_modules/editlet/skills/$s .agents/skills/$s
done
```

Commit the links if the team wants them for everyone. They are small and point into `node_modules`.

**Monorepo:** run `link.mjs` in the folder where Claude Code starts (usually the repo root), because the hook command
uses `$CLAUDE_PROJECT_DIR`. Run the content scripts with the app folder as root:
`node .claude/skills/editlet/scripts/validate.mjs apps/web` or `schema.mjs … --root apps/web`. The guard then
protects only `main` and `master` (a custom `git.baseBranch` is not known) and skips the commit check, because it
cannot find `cms/schema.json`, unless Claude Code starts in the app folder.

## The guard hook

`scripts/guard.mjs` runs before every Bash command Claude Code executes. It:

| Command | Decision |
|---|---|
| `git push` to the base branch, `main` or `master` (also `HEAD:main`, a bare `git push` on that branch, `--mirror`, `--all`, deleting it) | deny |
| `git commit` while files under `contentDir` or the schema changed and `validate` fails | deny, with the issues |
| `gh pr merge … --admin`; `gh api` writes to `…/protection` | deny |
| any other `gh pr merge` | ask (the human confirms in a permission prompt) |
| anything else | no opinion (normal permissions apply) |

It is a safety net, not a sandbox. Commands hidden in scripts, `bash -c "…"` strings or aliases can get past it, and
it judges `git` by the session's folder (`cd sub && git push` or `git -C other commit` are not followed). If the guard
fails while running, it denies the command. The hook protects only when `guard.mjs` and its dependencies load. A missing bundle, or a missing `yaml` / `zod`
(a fresh clone before `npm install`, or the source repo before `build.ts`), makes Node exit 1, which Claude Code treats
as a non-blocking error: the command then runs unguarded. `link.mjs --check --hooks` reports `guard missing` or
`guard broken` (exit 1); without `--check` it prints a `warning:` line. The real wall is branch protection on GitHub: require a PR for the base branch.

The entry it adds to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/skills/editlet/scripts/guard.mjs" }]
      }
    ]
  }
}
```

Optional extra permission rules for the same settings file: `"permissions": { "ask": ["Bash(gh pr merge:*)"] }`.

## Upgrade

1. `npm install editlet`, with the
   project's package manager.
2. `node node_modules/editlet/skills/editlet/scripts/link.mjs --hooks`: the links follow the new version on their own;
   this adds links for new skills and removes stale ones.
3. `node .claude/skills/editlet/scripts/validate.mjs`: does the new version read the content differently?
4. The project's build. Read the package's release notes for breaking changes before you fix anything.

## A script is missing

The `.mjs` scripts are built when the package is packed. In the Editlet source repo itself, build them first:

```bash
node packages/editlet/skills/editlet/scripts/build.ts
```

Never run the `.ts` sources from `node_modules` with `node`. Node does not strip types inside `node_modules`.
