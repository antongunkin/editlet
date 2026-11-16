import { slugify } from '../../../core/paths';

// Every branch the CMS creates or edits lives under the workspace's prefix (`git.branchPrefix`, default `editlet/`).

/** `?editlet=branch:<x>` value → branch name. A value that already starts with the prefix is taken as is. */
export function branchFromRoute(name: string, prefix: string): string {
  return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

/** Branch name → `?editlet=branch:<x>` value (without the prefix). */
export function routeFromBranch(branch: string, prefix: string): string {
  return branch.startsWith(prefix) ? branch.slice(prefix.length) : branch;
}

/** Typed branch name → the part after the prefix: trimmed, lowercase, spaces and underscores as `-`, no typed prefix. */
export function normalizeBranchInput(input: string, prefix: string): string {
  let name = input.trim().toLowerCase();
  if (name.startsWith(prefix)) name = name.slice(prefix.length);
  return name.replace(/[\s_]+/g, '-');
}

/** `<prefix><collection>-<slug>` (`<prefix><collection>` for a singleton), suffixed `-2`, `-3`… until not in `taken`. */
export function defaultBranchName(
  prefix: string,
  collection: string,
  slug: string,
  singleton: boolean,
  taken: Iterable<string>,
): string {
  const base = `${prefix}${slugify(singleton ? collection : `${collection}-${slug}`) || 'edit'}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
