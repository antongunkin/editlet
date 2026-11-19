import type { DevGitFile } from '../core/devApi';

/** One entry of `git status --porcelain=v1 -z`: the two status columns, the path and, for a rename or copy, the old path. */
export interface PorcelainEntry {
  xy: string;
  path: string;
  from?: string;
}

/**
 * Splits `git status --porcelain=v1 -z` output into entries. Each is `XY <path>\0`; a rename or copy (`R` or `C` in
 * either column) is followed by `<old path>\0`. Paths are raw (no quoting with `-z`) and relative to the top level.
 */
export function porcelainEntries(out: string): PorcelainEntry[] {
  const fields = out.split('\0');
  const entries: PorcelainEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.length < 4) continue;
    const xy = field.slice(0, 2);
    const entry: PorcelainEntry = { xy, path: field.slice(3) };
    if (/[RC]/.test(xy)) entry.from = fields[++i];
    entries.push(entry);
  }
  return entries;
}

/**
 * The uncommitted files of `git status --porcelain=v1 -z`, with `prefix` (`git rev-parse --show-prefix`, the
 * project's folder inside the repository) stripped so the paths are relative to the project root. Both columns count:
 * `?` or `A` → added (`AD`: added, then deleted again → nothing), `D` → removed, `R` / `C` → the new path added (and,
 * for `R`, the old path removed; `RD` / `CD`, whose new path is gone again, keep only the removal), anything else
 * (`M`, `T`) → modified. A merge conflict with a `U` column (`UU`, `AU`, `UD`…) is modified; `AA` is added and `DD`
 * removed. A path listed twice (`D ` and `??` after `git rm --cached`) is modified. Paths outside `prefix` are dropped.
 */
export function parsePorcelainZ(out: string, prefix: string): DevGitFile[] {
  const files = new Map<string, DevGitFile['status']>();
  const add = (path: string | undefined, status: DevGitFile['status']) => {
    if (path === undefined || !path.startsWith(prefix)) return;
    const key = path.slice(prefix.length);
    const seen = files.get(key);
    // `git rm --cached f` lists `D  f` and `?? f`: the file is still on disk, with other content than HEAD's.
    files.set(key, seen !== undefined && seen !== status ? 'modified' : status);
  };
  for (const { xy, path, from } of porcelainEntries(out)) {
    const [x, y] = xy;
    if (xy === 'AD') continue;
    if (xy.includes('U')) add(path, 'modified');
    else if (x === 'R' || y === 'R') {
      // `RD`: renamed in the index, then the new path deleted from the worktree: only the old path is gone.
      if (y !== 'D') add(path, 'added');
      add(from, 'removed');
    } else if (x === 'C' || y === 'C') {
      if (y !== 'D') add(path, 'added');
    } else if (xy.includes('D')) add(path, 'removed');
    else if (xy.includes('?') || xy.includes('A')) add(path, 'added');
    else add(path, 'modified');
  }
  return [...files].map(([path, status]) => ({ path, status }));
}
