import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { reportIssues } from './issues';
import {
  checkChanges,
  loadContext,
  planRemoveField,
  planRenameField,
  UsageError,
  withCandidateFiles,
  type Plan,
} from './schemaOps';

import { toJsonSchema } from '../../../core/generate';
import { EditletError } from '../../../core/issues';
import { isHiddenContentPath, parseEntryPath } from '../../../core/paths';
import { parseSchemaText } from '../../../core/schema';

const USAGE = `Usage: schema <command> [args] [--root <dir>]

Commands:
  check <candidate.json>   (relative to --root when given, else cwd) validate a candidate schema against all existing entries
  json-schema [collection] print the JSON Schema of one collection (or of all)
  rename-field <collection> <from> <to>   rename a field in the schema and in every entry (dry run; --apply writes)
  remove-field <collection> <field>       remove a field from the schema and entries (dry run; --apply writes)
`;

type Handler = (args: string[], root: string, apply: boolean) => Promise<void>;

async function runPlan(root: string, plan: Plan, schemaPath: string, summary: string, apply: boolean): Promise<void> {
  if (plan.issues.length > 0) return reportIssues(plan.issues);
  const out = [`schema: ${schemaPath} (${summary})`];
  const rewritten = new Set(plan.rewritten ?? []);
  for (const change of plan.changes) {
    if (change.path === schemaPath) continue;
    out.push(`entry: ${change.path}${rewritten.has(change.path) ? ' (rewritten in standard format)' : ''}`);
  }
  out.push(...plan.notes);
  if (apply) {
    // Entries first, the schema last: a failure midway never leaves a schema that the entries do not match.
    const ordered = [
      ...plan.changes.filter((c) => c.path !== schemaPath),
      ...plan.changes.filter((c) => c.path === schemaPath),
    ];
    const written: string[] = [];
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
        if (written.length > 0) process.stderr.write(`already written: ${written.join(', ')}\n`);
        process.exitCode = 1;
        return;
      }
      written.push(path);
    }
    out.push(`applied: ${plan.changes.length} files written`);
  } else out.push('dry run: nothing written; add --apply to write');
  process.stdout.write(`${out.join('\n')}\n`);
}

const handlers: Record<string, Handler> = {
  async check([candidate], root) {
    if (!candidate) throw new UsageError('check: missing <candidate.json>');
    let text: string;
    try {
      text = await readFile(resolve(root, candidate), 'utf8');
    } catch (error) {
      throw new UsageError(`check: cannot read ${candidate}: ${error instanceof Error ? error.message : error}`);
    }
    const ctx = await withCandidateFiles(await loadContext(root), text);
    const issues = checkChanges(ctx, [{ path: ctx.schemaPath, content: text }]);
    if (issues.length > 0) return reportIssues(issues);
    let effective = ctx.schema;
    try {
      effective = parseSchemaText(text, ctx.schemaPath);
    } catch {
      // an invalid candidate was reported above
    }
    const entries = [...ctx.files.keys()].filter(
      (path) => parseEntryPath(effective, path) !== null && !isHiddenContentPath(effective, path),
    ).length;
    process.stdout.write(`✓ schema change is safe (${entries} entries checked)\n`);
  },
  async 'rename-field'([collection, from, to], root, apply) {
    if (!collection || !from || !to) throw new UsageError('rename-field: expected <collection> <from> <to>');
    const ctx = await loadContext(root);
    const plan = planRenameField(ctx, collection, from, to);
    await runPlan(root, plan, ctx.schemaPath, `${collection}.${from} → ${collection}.${to}`, apply);
  },
  async 'remove-field'([collection, field], root, apply) {
    if (!collection || !field) throw new UsageError('remove-field: expected <collection> <field>');
    const ctx = await loadContext(root);
    const plan = planRemoveField(ctx, collection, field);
    await runPlan(root, plan, ctx.schemaPath, `remove ${collection}.${field}`, apply);
  },
  async 'json-schema'([collection], root) {
    const { schema } = await loadContext(root);
    let out: unknown;
    if (collection === undefined) {
      out = Object.fromEntries(Object.entries(schema.collections).map(([key, c]) => [key, toJsonSchema(c)]));
    } else {
      if (!Object.hasOwn(schema.collections, collection)) {
        throw new UsageError(
          `Unknown collection "${collection}" (known: ${Object.keys(schema.collections).join(', ')})`,
        );
      }
      out = toJsonSchema(schema.collections[collection]);
    }
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  },
};

function parseCli() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { root: { type: 'string' }, apply: { type: 'boolean' } },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

try {
  const { values, positionals } = parseCli();
  const [command, ...args] = positionals;
  if (!command || !Object.hasOwn(handlers, command))
    throw new UsageError(command ? `Unknown command "${command}"` : '');
  await handlers[command](args, resolve(values.root ?? process.cwd()), values.apply === true);
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message ? `${error.message}\n` : ''}${USAGE}`);
    process.exitCode = 2;
  } else if (error instanceof EditletError) reportIssues(error.issues);
  else throw error;
}
