import type { Issue } from '../../../core/issues';
import { relativeAssetSrc, slugify } from '../../../core/paths';

/**
 * The top-level fields with a required value still missing, from a validation's issues: a required field inside an
 * object or a block (`seo.title`, `content.2.text`) counts for its row (`seo`, `content`).
 */
export function requiredFieldKeys(issues: Issue[]): Set<string> {
  return new Set(issues.flatMap((i) => (i.message === 'Required' && i.path !== '' ? [i.path.split('.')[0]!] : [])));
}

/**
 * Groups issues by top-level field (`tags.2` → `tags`, message `2: …`). File-level issues (`path: ''`) and unknown
 * frontmatter keys (`Unknown field`) go to `general`, shown above the form.
 */
export function issuesByField(issues: Issue[]): { fields: Record<string, string[]>; general: string[] } {
  const fields: Record<string, string[]> = {};
  const general: string[] = [];
  for (const issue of issues) {
    if (issue.path === '') {
      general.push(issue.message);
      continue;
    }
    if (issue.message === 'Unknown field') {
      general.push(`${issue.path}: ${issue.message}`);
      continue;
    }
    const dot = issue.path.indexOf('.');
    const key = dot === -1 ? issue.path : issue.path.slice(0, dot);
    const message = dot === -1 ? issue.message : `${issue.path.slice(dot + 1)}: ${issue.message}`;
    (fields[key] ??= []).push(message);
  }
  return { fields, general };
}

/** `<dir>/<slugified name>.<lowercased ext>`, with `-2`, `-3`, … on collision (case-insensitive). */
export function uniqueAssetPath(existing: Set<string>, dir: string, fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? `.${fileName.slice(dot + 1).toLowerCase()}` : '';
  const name = slugify(base) || 'image';
  const taken = new Set([...existing].map((p) => p.toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = `${dir}/${n === 1 ? name : `${name}-${n}`}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Inverse of `resolveAssetPath` (core `relativeAssetSrc`): the `src` for `assetPath` relative to the entry file. */
export const relativeSrc = relativeAssetSrc;
