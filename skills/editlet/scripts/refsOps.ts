import { isDeepStrictEqual } from 'node:util';

import { UsageError, type ProjectContext } from './schemaOps';

import { decodeUtf8, parseEntryFile, serializeEntryFile } from '../../../core/entryFile';
import { EditletError, type Issue } from '../../../core/issues';
import { parseEntryPath, refKey } from '../../../core/paths';
import { findReferrers } from '../../../core/references';
import { planRemove, planRename, type EntryRewrite, type PlanEntry } from '../../../core/rename';
import type { FileChange } from '../../../core/source';
import { validateChanges } from '../../../core/writes';

/** An entry of the project with its file text. */
export interface TextEntry extends PlanEntry {
  path: string;
  text: string;
}

/** Every parseable entry of the project, in path order. */
export function projectEntries(ctx: ProjectContext): TextEntry[] {
  const out: TextEntry[] = [];
  for (const [path, bytes] of ctx.files) {
    const parsed = parseEntryPath(ctx.schema, path);
    if (!parsed) continue;
    const decoded = decodeUtf8(bytes, path);
    if (!('text' in decoded)) continue;
    try {
      out.push({ ...parsed, path, text: decoded.text, ...parseEntryFile(decoded.text) });
    } catch {
      // An unparseable entry is reported by the whole-batch check.
    }
  }
  return out.toSorted((a, b) => a.path.localeCompare(b.path));
}

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` with `from` replaced by `to` where it stands alone (not part of a longer path or ref). */
function replaceToken(text: string, from: string, to: string): string {
  return text.replace(new RegExp(`(?<![\\w./-])${escape(from)}(?![\\w./-])`, 'g'), to);
}

/** The frontmatter without the lines that hold only `from` (a list item `- from`, or `key: from`). */
function removeLines(text: string, from: string): string {
  const end = text.indexOf('\n---', 4);
  if (!text.startsWith('---') || end === -1) return text;
  const line = new RegExp(`^\\s*(?:-|[A-Za-z][A-Za-z0-9]*:)\\s+['"]?${escape(from)}['"]?\\s*$`);
  const head = text
    .slice(0, end)
    .split('\n')
    .filter((l) => !line.test(l))
    .join('\n');
  // A key whose list lost its last item: `questions:` with nothing under it.
  const emptied = head
    .replace(/^([A-Za-z][A-Za-z0-9]*):[ \t]*\n(?=[A-Za-z]|$)/gm, '')
    .replace(/^([A-Za-z][A-Za-z0-9]*):[ \t]*$(?![\s\S])/m, '');
  return emptied + text.slice(end);
}

/**
 * The new text of a rewritten entry: the original text with exactly the planned replacements, when it reads back as
 * the planned data and body; else the whole file in the standard format (`rewritten`).
 */
export function rewriteText(write: EntryRewrite<TextEntry>): { text: string; rewritten: boolean } {
  let text = write.entry.text;
  for (const { from, to } of write.replacements)
    text = to === null ? removeLines(text, from) : replaceToken(text, from, to);
  try {
    const back = parseEntryFile(text);
    if (isDeepStrictEqual(back.data, write.data) && back.body === write.body) return { text, rewritten: false };
  } catch {
    // fall through to the serializer
  }
  const order = Object.keys(write.entry.data);
  return { text: serializeEntryFile({ data: write.data, body: write.body }, order), rewritten: true };
}

export interface RefsPlan {
  changes: FileChange[];
  /** Output lines, in order. */
  lines: string[];
  issues: Issue[];
}

function planned(fn: () => RefsPlan): RefsPlan {
  try {
    return fn();
  } catch (error) {
    if (error instanceof EditletError) throw new UsageError(error.issues.map((i) => i.message).join('; '));
    throw error;
  }
}

/** Checks the whole batch like a commit would, against the project files. */
function check(ctx: ProjectContext, changes: FileChange[]): Issue[] {
  return validateChanges(ctx.context, changes);
}

function entryLines(writes: EntryRewrite<TextEntry>[], changes: FileChange[]): string[] {
  return writes.map((w) => {
    const { text, rewritten } = rewriteText(w);
    changes.push({ path: w.path, content: text });
    const what = w.reasons.filter((r) => r !== 'renamed').join(', ');
    return `entry: ${w.path}${w.reasons.includes('renamed') ? ' (new path)' : ''}${what ? ` (${what})` : ''}${rewritten ? ' (rewritten in standard format)' : ''}`;
  });
}

/** `rename <ref> <slug>`: the plan and its file changes (moved files carry their bytes). */
export function planRenameRef(ctx: ProjectContext, ref: string, to: string): RefsPlan {
  return planned(() => {
    const entries = projectEntries(ctx);
    const plan = planRename(ctx.schema, entries, ctx.files.keys(), ref, to);
    const changes: FileChange[] = [];
    const lines = [`rename: ${plan.from} → ${plan.to}`, ...entryLines(plan.write, changes)];
    for (const path of plan.remove) {
      changes.push({ path, content: null });
      lines.push(`delete: ${path}`);
    }
    for (const { from, to: target } of plan.move) {
      changes.push({ path: target, content: ctx.files.get(from)! }, { path: from, content: null });
      lines.push(`move: ${from} → ${target}`);
    }
    return { changes, lines, issues: check(ctx, changes) };
  });
}

/** `remove <ref>`: delete the entry and remove every reference to it. Its images stay. */
export function planRemoveRef(ctx: ProjectContext, ref: string): RefsPlan {
  return planned(() => {
    const entries = projectEntries(ctx);
    const plan = planRemove(ctx.schema, entries, ref);
    const changes: FileChange[] = [];
    const lines = [`remove: ${ref}`, ...entryLines(plan.write, changes)];
    for (const path of plan.remove) {
      changes.push({ path, content: null });
      lines.push(`delete: ${path}`);
    }
    return { changes, lines, issues: check(ctx, changes) };
  });
}

/** `used-by <ref>`: one line per entry that references it, with the fields. */
export function usedBy(ctx: ProjectContext, ref: string): string[] {
  const entries = projectEntries(ctx);
  if (!entries.some((e) => refKey(e.collection, e.slug) === ref)) throw new UsageError(`Entry not found: ${ref}`);
  return findReferrers(ctx.schema, entries, ref).map((r) => `${r.entry.path}: ${r.fields.join(', ')}`);
}
