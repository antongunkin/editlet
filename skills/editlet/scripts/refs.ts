import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { reportIssues } from './issues';
import { planRemoveRef, planRenameRef, usedBy, type RefsPlan } from './refsOps';
import { loadContext, UsageError } from './schemaOps';

import { EditletError } from '../../../core/issues';

const USAGE = `Usage: refs <command> [args] [--root <dir>] [--apply]

Commands:
  used-by <collection/slug>              list the entries that reference it, with the fields
  rename <collection/slug> <new-slug>    rename the entry: its file and folder move, every reference and image src
                                         follows (dry run; --apply writes)
  remove <collection/slug>               delete the entry and remove every reference to it; its images stay
                                         (dry run; --apply writes)
`;

/** Prints the plan; with `apply`, writes new and changed files first, then deletes. */
async function runPlan(root: string, plan: RefsPlan, apply: boolean): Promise<void> {
  if (plan.issues.length > 0) return reportIssues(plan.issues);
  const out = [...plan.lines];
  if (apply) {
    const ordered = [
      ...plan.changes.filter((c) => c.content !== null),
      ...plan.changes.filter((c) => c.content === null),
    ];
    const done: string[] = [];
    for (const { path, content } of ordered) {
      const file = join(root, path);
      try {
        if (content === null) await rm(file, { force: true });
        else {
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, content);
        }
      } catch (error) {
        process.stderr.write(`write failed: ${path}: ${error instanceof Error ? error.message : error}\n`);
        if (done.length > 0) process.stderr.write(`already written: ${done.join(', ')}\n`);
        process.exitCode = 1;
        return;
      }
      done.push(path);
    }
    out.push(`applied: ${plan.changes.length} file changes`);
  } else out.push('dry run: nothing written; add --apply to write');
  process.stdout.write(`${out.join('\n')}\n`);
}

const handlers: Record<string, (args: string[], root: string, apply: boolean) => Promise<void>> = {
  async 'used-by'([ref], root) {
    if (!ref) throw new UsageError('used-by: missing <collection/slug>');
    const lines = usedBy(await loadContext(root), ref);
    process.stdout.write(lines.length > 0 ? `${lines.join('\n')}\n` : `no entry references ${ref}\n`);
  },
  async rename([ref, slug], root, apply) {
    if (!ref || !slug) throw new UsageError('rename: expected <collection/slug> <new-slug>');
    await runPlan(root, planRenameRef(await loadContext(root), ref, slug), apply);
  },
  async remove([ref], root, apply) {
    if (!ref) throw new UsageError('remove: missing <collection/slug>');
    await runPlan(root, planRemoveRef(await loadContext(root), ref), apply);
  },
};

function parseCli() {
  try {
    return parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, apply: { type: 'boolean' } } });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

try {
  const { values, positionals } = parseCli();
  const [command, ...args] = positionals;
  if (!command || !Object.hasOwn(handlers, command))
    throw new UsageError(command ? `Unknown command "${command}"` : '');
  await handlers[command]!(args, resolve(values.root ?? process.cwd()), values.apply === true);
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message ? `${error.message}\n` : ''}${USAGE}`);
    process.exitCode = 2;
  } else if (error instanceof EditletError) {
    reportIssues(error.issues);
  } else throw error;
}
