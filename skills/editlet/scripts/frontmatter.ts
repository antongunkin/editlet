/**
 * Line-level edits of the top-level keys in an entry file's YAML frontmatter. They keep every other byte (comments,
 * quoting, order) intact. `null` means "cannot edit by line" (flow mapping, quoted key, key absent, no frontmatter);
 * the caller falls back to the serializer.
 */

interface Block {
  lines: string[];
  /** Index of the closing `---` line. */
  close: number;
}

function frontmatter(text: string): Block | null {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
  const lines = text.split('\n');
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  return close === -1 ? null : { lines, close };
}

function keyLine(lines: string[], close: number, key: string): number {
  const prefix = `${key}:`;
  return lines.findIndex(
    (line, i) => i > 0 && i < close && line.startsWith(prefix) && /^\s?$/.test(line[prefix.length] ?? ''),
  );
}

/** Index after the last line belonging to the value that starts on `start` (`start` is the key line). */
function valueEnd(lines: string[], start: number, close: number): number {
  let end = start + 1;
  let last = start + 1;
  while (end < close) {
    const line = lines[end];
    if (line.trim() === '') end++;
    else if (/^\s/.test(line) || line.startsWith('- ') || line.trimEnd() === '-') {
      end++;
      last = end;
    } else break;
  }
  return last;
}

export function renameTopLevelKey(text: string, from: string, to: string): string | null {
  const block = frontmatter(text);
  if (!block) return null;
  const at = keyLine(block.lines, block.close, from);
  if (at === -1) return null;
  const lines = [...block.lines];
  lines[at] = `${to}:${lines[at].slice(from.length + 1)}`;
  return lines.join('\n');
}

export function removeTopLevelKey(text: string, key: string): string | null {
  const block = frontmatter(text);
  if (!block) return null;
  const at = keyLine(block.lines, block.close, key);
  if (at === -1) return null;
  const lines = [...block.lines];
  lines.splice(at, valueEnd(lines, at, block.close) - at);
  return lines.join('\n');
}

/** The frontmatter block of `text` with the body dropped (`''` when there is no frontmatter). */
export function withoutBody(text: string): string {
  const block = frontmatter(text);
  return block ? `${block.lines.slice(0, block.close + 1).join('\n')}\n` : '';
}
