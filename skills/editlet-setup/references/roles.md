# Roles: admins and editors

Use this when the human wants copywriters (editors) who change only content, and admins (developers) who own code,
the schema and settings. Editlet has no roles of its own: **GitHub enforces everything** with teams, `CODEOWNERS`
and rulesets. You find out what the plan allows, write `.github/CODEOWNERS`, and prepare the rulesets. The human
approves every change outside the repo.

Do the live-site setup ([production](production.md)) first: editors need the editor to work before roles matter.

## Rules for this workflow

1. **Read only, until the human says yes.** `gh api` GETs are fine. Every write (`-X POST`, `-X PUT`, `-X PATCH`,
   `-f`, `--input`) is a change outside the repo: show the exact command and its JSON first, run it only after an
   explicit yes, one command at a time.
2. **`.github/CODEOWNERS` is code.** Leave it uncommitted, or commit it on `setup/editlet` and open a PR. Never on the
   base branch, never on an `editlet/*` branch.
3. **Merge `CODEOWNERS` before you create the rulesets.** GitHub reads it from the base branch. If the review rules
   come first, the setup PR itself may be blocked (see § 7).
4. **Never add a bypass the human did not ask for**, and never remove an existing rule to make a step pass.

## 1. Look

```bash
gh api repos/<owner>/<repo> --jq '{owner: .owner.type, visibility, admin: .permissions.admin}'
node -e "const s=require('./cms/schema.json'); console.log(s.contentDir, s.git.baseBranch)"
```

- `admin` must be `true`: only a repository admin can create rulesets. If not, stop and say who must do it.
- `owner` and `visibility` decide what is possible:

| Account and repo | Teams | Rulesets, `CODEOWNERS` | Push rules (§ 5) |
|---|---|---|---|
| Organization, public | yes | yes, on every plan | no (private and internal only) |
| Organization, private | yes | Team or Enterprise plan | Team or Enterprise plan |
| Personal account, public | no: name users | yes, on every plan | no |
| Personal account, private | no: name users | GitHub Pro | no |

GitHub's checks are the truth: if a ruleset call below answers `403` or `422` with a plan message, the plan does not
have it. Say so and continue without that part.

Then ask the human, once:

- **Who approves content?** (a) editors approve each other, admins can too; (b) only admins approve anything;
  (c) per folder (for example blog posts by editors, legal pages by admins). With (a), an editor can also click Merge
  after a colleague approves (§ 6).
- **The team names**, or (personal account) the logins of the admins and the editors.
- **Media outside `contentDir`**, if the site keeps images elsewhere (for example `public/images/`).

## 2. Teams (organizations only)

```bash
gh api orgs/<org>/teams --jq '.[] | {slug, privacy}'
gh api repos/<owner>/<repo>/teams --jq '.[] | {slug, permission}'
```

Both teams must exist, be visible (`privacy: closed`, not `secret`), and have at least **write** on the repo
(`push`); admins get `admin` or `maintain`. If something is missing, the commands are (each after a yes):

```bash
gh api -X POST orgs/<org>/teams -f name=editors -f privacy=closed
gh api -X PUT orgs/<org>/teams/editors/repos/<owner>/<repo> -f permission=push
gh api -X PUT orgs/<org>/teams/admins/repos/<owner>/<repo> -f permission=admin
```

Adding people to the teams is the human's step (GitHub → the organization → Teams).

## 3. `.github/CODEOWNERS`

Patterns are `.gitignore`-style, paths from the repo root, case-sensitive. **The last matching line wins.** No `!`,
no `[ ]`. Several owners on one line: **any one** of them can approve. Owners must have write access.

Variant (a), with `contentDir` = `cms/content`:

```gitignore
# Everything else (code, schema, settings): admins
*                       @<org>/admins

# Content and the images next to entries: editors, admins too
/cms/content/           @<org>/editors @<org>/admins

# Only if images live outside contentDir
/public/images/         @<org>/editors @<org>/admins

# Keep last: nobody but admins changes the owners
/.github/CODEOWNERS     @<org>/admins
```

- Variant (b): only the first and the last line.
- Variant (c): per-folder lines under `/cms/content/`, for example `/cms/content/legal/ @<org>/admins` after the
  `/cms/content/` line (later lines win).
- Personal account: users instead of teams, `@alice @bob` (each must be a collaborator).
- `cms/schema.json` is outside `/cms/content/`, so it stays with the admins. Use the schema's real `contentDir`.

If the file exists, show a diff and change only what the human agreed to. After the PR is merged, check it:

```bash
gh api "repos/<owner>/<repo>/codeowners/errors?ref=<base>" --jq '.errors'
```

`[]` means GitHub accepted every line. Each error has `line`, `kind` and `message`; fix and repeat.

## 4. Ruleset on the base branch

This replaces the simple ruleset from [production § 5](production.md#5-protect-the-base-branch) or adds to it (rules
from several rulesets add up; the strictest wins). Check what exists first:

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[] | {id, name, target, enforcement}'
gh api repos/<owner>/<repo>/rules/branches/<base>
```

Write the body to a temp file outside the repo, show it, and after a yes run
`gh api -X POST repos/<owner>/<repo>/rulesets --input <file>`:

```json
{
  "name": "Editlet: review before merge",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/<base>"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "dismiss_stale_reviews_on_push": true,
        "required_review_thread_resolution": false
      }
    }
  ]
}
```

- `require_last_push_approval`: someone other than the last pusher must approve, so nobody approves their own edit.
- `enforcement` is `active`. `evaluate` exists only on GitHub Enterprise.
- **One admin only?** See § 7 before creating this.

## 5. Who may create branches, and who may touch code

**Branch creation** (every plan that has rulesets). Editors may create only Editlet branches: `<prefix>*`, where the
prefix is `git.branchPrefix` of the schema (default `editlet/`). In fnmatch `*` does not match `/`, so the pattern is
`<prefix>**/*`, below for the default:

```json
{
  "name": "Editlet: editors create only editlet/ branches",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~ALL"], "exclude": ["refs/heads/editlet/**/*"] } },
  "bypass_actors": [{ "actor_type": "Team", "actor_id": <admins team id>, "bypass_mode": "always" }],
  "rules": [{ "type": "creation" }]
}
```

Get the team id with `gh api orgs/<org>/teams/admins --jq .id`. Personal account: use the owner as a `User` actor
(`gh api users/<login> --jq .id`); if GitHub refuses that, ask the human to add the bypass in the UI (Settings → Rules
→ the ruleset → Bypass list → Repository admin) and read the ruleset back to see the actor it stored.

**Push rules** (organization, private or internal repo, Team plan or higher). Editors cannot push anything outside
the content folders, to any branch, even through the API. `ignored_file_paths` are the allowed exceptions:

```json
{
  "name": "Editlet: editors push only content",
  "target": "push",
  "enforcement": "active",
  "bypass_actors": [{ "actor_type": "Team", "actor_id": <admins team id>, "bypass_mode": "always" }],
  "rules": [
    {
      "type": "file_path_restriction",
      "parameters": {
        "restricted_file_paths": ["**/*", ".*", ".*/**/*"],
        "ignored_file_paths": ["cms/content/**/*"]
      }
    }
  ]
}
```

Add the media folder to `ignored_file_paths` if it is outside `contentDir` (`public/images/**/*`). `.*` and `.*/**/*`
cover dotfiles and `.github/`. Public repos have no push rules: there `CODEOWNERS` keeps code changes waiting for an
admin's approval, and the branch screen lists "Other files this merge brings in".

## 6. What editors can still do

Editors need the **Write** role: the editor refuses to work without push access. Write also lets them:

- push to any existing branch that no ruleset protects (add `{ "type": "update" }` to the branch-creation ruleset
  to stop that; admins bypass it);
- **merge a pull request once every rule passes.** With variant (a) an editor can merge after another editor
  approves. If only admins should merge, use variant (b);
- add labels, close pull requests and issues.

Say this to the human in plain words. Triage is not enough (no write); custom roles need GitHub Enterprise.

## 7. One admin

With `require_last_push_approval` and code owned by `@<org>/admins`, a PR from the only admin that touches code can
never be approved: there is no second admin. Offer two ways and let the human choose:

1. Add a second admin (recommended).
2. Let admins bypass the base ruleset **for pull requests only**: `"bypass_actors": [{ "actor_type": "Team",
   "actor_id": <admins team id>, "bypass_mode": "pull_request" }]`. The admin still has to open a PR, but can merge
   it without approval. The cost: whoever holds an admin token can merge code alone.

The same applies to this setup PR: merge it (rule 3) before § 4.

## 8. Check

```bash
gh api repos/<owner>/<repo>/rules/branches/<base> --jq '.[] | {type, parameters}'
gh api repos/<owner>/<repo>/rules/branches/doctor-probe --jq '[.[].type]'
gh api repos/<owner>/<repo>/rules/branches/editlet/doctor-probe --jq '[.[].type]'
gh api "repos/<owner>/<repo>/rulesets?targets=push" --jq '.[] | {id, name, enforcement}'
gh api "repos/<owner>/<repo>/codeowners/errors?ref=<base>" --jq '.errors'
```

The branches need not exist. Expect: `pull_request` with `require_code_owner_review: true` and
`require_last_push_approval: true` on the base; `creation` on `doctor-probe` but **not** on `editlet/doctor-probe` (if it
is there, the editor cannot create branches at all: fix the exclude pattern); the push ruleset when § 5 applies; no
CODEOWNERS errors. `doctor.mjs --url <site>` runs the same checks (`github.codeowners`, `github.code-owner-review`,
`github.creations`, `github.push-rules`, `github.labels`).

What you cannot check with the admin's token: how it feels for an editor. Ask the human to sign in to `?editlet` with an
editor account, save an entry (a branch appears, the pull request asks for the right reviewers), and, on a private
repo with push rules, see that a change to `cms/schema.json` is refused.

## What the human does, as a checklist for your final message

1. Add people to the teams (or invite the collaborators).
2. Review and merge the `CODEOWNERS` PR.
3. Say yes to each ruleset command, or create them in the UI with the same values.
4. Test once with an editor account (§ 8).
