// The Editlet git style for agents: branch names, commit messages and pull request title and body, from
// `git` of cms/schema.json, the same rules the admin uses (core/gitStyle.ts).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  changesSubject,
  entrySubject,
  renameSubject,
  formatCommitMessage,
  formatPullRequestTitle,
  mergePullRequestBody,
  pullRequestBlock,
  resolveGitStyle,
  withTrailer,
  describeChanges,
  type CommitAction,
} from '../../../core/gitStyle';
import { EditletError } from '../../../core/issues';
import { slugify } from '../../../core/paths';
import { EDITLET_PARAM } from '../../../loader/protocol';
import { DEFAULT_SCHEMA_PATH, loadProjectSchema } from '../../../node/fs';

const USAGE = `Usage: node style.mjs <command> [--root <dir>]
  branch <name>                      the branch for a change set: <prefix><name>
  commit <action> <collection>/<slug>  a commit message (action: create, update, delete, upload)
  commit rename <collection>/<old> <new>  the message of a slug rename (refs.mjs rename)
  commit --staged                    a commit message for the staged files
  pr <branch> --login <login> [--site <url>] [--param <name>]  JSON { title, body, labels, draft } from <base>...HEAD
  pr-body <branch> --login <login> [--site <url>] [--param <name>]  the current body on stdin → the body with the Editlet part replaced
`;

type Status = 'added' | 'modified' | 'removed';

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}`);
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value`);
  args.splice(i, 2);
  return value;
}

/** `git diff --name-status` lines → paths with a status (a rename is a delete and an add). */
function nameStatus(root: string, diffArgs: string[]): { path: string; status: Status }[] {
  const out = execFileSync('git', ['diff', '--name-status', '--no-renames', ...diffArgs], {
    cwd: root,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code = '', path = ''] = line.split('\t');
      const status: Status = code.startsWith('A') ? 'added' : code.startsWith('D') ? 'removed' : 'modified';
      return { path, status };
    });
}

const args = process.argv.slice(2);
const root = option(args, '--root') ?? process.cwd();
const [command, ...rest] = args;

let schema;
try {
  schema = await loadProjectSchema(root, DEFAULT_SCHEMA_PATH);
} catch (error) {
  if (!(error instanceof EditletError)) throw error;
  process.stderr.write(`${DEFAULT_SCHEMA_PATH} is invalid; run validate.mjs\n`);
  process.exit(1);
}
const style = resolveGitStyle(schema.git);

switch (command) {
  case 'branch': {
    const name = slugify(rest.join(' '));
    if (!name) fail('branch needs a name');
    process.stdout.write(`${style.branchPrefix}${name}\n`);
    break;
  }
  case 'commit': {
    let subject;
    if (rest[0] === '--staged') {
      const files = nameStatus(root, ['--cached', '--', '.']);
      if (files.length === 0) fail('nothing is staged');
      subject = changesSubject(schema, DEFAULT_SCHEMA_PATH, files);
    } else {
      const [action, ref = '', to] = rest;
      const [collection, slug] = ref.split('/');
      if (!['create', 'update', 'delete', 'upload', 'rename'].includes(action ?? '') || !collection || !slug) {
        fail('commit needs an action and <collection>/<slug>');
      }
      if (action === 'rename' && !to) fail('commit rename needs <collection>/<old> <new>');
      subject =
        action === 'rename'
          ? renameSubject(collection, slug, to!)
          : entrySubject(action as CommitAction, collection, slug);
    }
    process.stdout.write(`${withTrailer(formatCommitMessage(style, subject), 'agent')}\n`);
    break;
  }
  case 'pr':
  case 'pr-body': {
    const login = option(rest, '--login');
    const site = option(rest, '--site');
    // The site's editor query parameter: `EDITLET_PARAM` of the site, when it sets one (default `editlet`).
    const param = option(rest, '--param') ?? process.env.EDITLET_PARAM?.trim() ?? EDITLET_PARAM;
    const [branch] = rest;
    if (!branch || !login) fail(`${command} needs a branch and --login`);
    const changes = describeChanges(
      schema,
      nameStatus(root, [`${schema.git.baseBranch}...HEAD`, '--', DEFAULT_SCHEMA_PATH, schema.contentDir]),
    );
    const name = branch.startsWith(style.branchPrefix) ? branch.slice(style.branchPrefix.length) : branch;
    const reviewUrl = site ? `${site.replace(/\/+$/, '')}/?${param || EDITLET_PARAM}=branch:${name}` : null;
    const block = pullRequestBlock({ login, changes, reviewUrl });
    if (command === 'pr') {
      const title = formatPullRequestTitle(style, { branch, login });
      const { labels, draft } = style.pullRequest;
      process.stdout.write(`${JSON.stringify({ title, body: block, labels, draft }, null, 2)}\n`);
    } else {
      const current = readFileSync(0, 'utf8');
      process.stdout.write(mergePullRequestBody(current, block) ?? current);
    }
    break;
  }
  default:
    fail(command ? `unknown command "${command}"` : 'no command');
}
