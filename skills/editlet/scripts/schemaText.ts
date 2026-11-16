/**
 * Text-level edits of `cms/schema.json`, so a schema change shows up as a minimal diff. Every edit is verified by
 * re-parsing the result and comparing it (key order included) with the expected object; `null` means "no verified
 * text edit" and the caller falls back to re-serializing the whole file.
 */

const MAX_RENAME_OCCURRENCES = 12;

interface Member {
  key: string;
  keyStart: number;
  valStart: number;
  valEnd: number;
  value: Node;
}
interface Node {
  start: number;
  end: number;
  members?: Member[];
}

/** Parses JSON text into a tree of spans; only objects are descended into. Throws on malformed input. */
function parseSpans(text: string): Node {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
  };
  const string = (): string => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) throw new Error('unterminated string');
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): Node => {
    ws();
    const start = i;
    const ch = text[i];
    if (ch === '{') {
      i++;
      const members: Member[] = [];
      ws();
      if (text[i] === '}') i++;
      else {
        for (;;) {
          ws();
          const keyStart = i;
          if (text[i] !== '"') throw new Error('expected key');
          const key = string();
          ws();
          if (text[i++] !== ':') throw new Error('expected colon');
          ws();
          const valStart = i;
          const node = value();
          members.push({ key, keyStart, valStart, valEnd: node.end, value: node });
          ws();
          if (text[i] === ',') i++;
          else if (text[i] === '}') {
            i++;
            break;
          } else throw new Error('expected , or }');
        }
      }
      return { start, end: i, members };
    }
    if (ch === '[') {
      i++;
      ws();
      if (text[i] === ']') i++;
      else {
        for (;;) {
          value();
          ws();
          if (text[i] === ',') i++;
          else if (text[i] === ']') {
            i++;
            break;
          } else throw new Error('expected , or ]');
        }
      }
      return { start, end: i };
    }
    if (ch === '"') {
      string();
      return { start, end: i };
    }
    while (i < text.length && !',}] \t\r\n'.includes(text[i])) i++;
    if (i === start) throw new Error('unexpected character');
    return { start, end: i };
  };
  const root = value();
  ws();
  if (i !== text.length) throw new Error('trailing content');
  return root;
}

const member = (node: Node | undefined, key: string): Member | undefined => node?.members?.find((m) => m.key === key);

function verified(text: string, expected: unknown): string | null {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(expected) ? text : null;
  } catch {
    return null;
  }
}

function collectionNode(text: string, collection: string): Node | undefined {
  return member(member(parseSpans(text), 'collections')?.value, collection)?.value;
}

/** Every JSON string token (spans include the quotes) whose decoded value is `value`, within `[from, to)`. */
function stringTokens(text: string, value: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let i = from;
  while (i < to) {
    if (text[i] !== '"') {
      i++;
      continue;
    }
    const start = i++;
    while (i < to && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    try {
      if (JSON.parse(text.slice(start, i)) === value) out.push([start, i]);
    } catch {
      return out;
    }
  }
  return out;
}

function* subsets(n: number, size: number, from = 0, chosen: number[] = []): Generator<number[]> {
  if (chosen.length === size) yield chosen;
  else for (let k = from; k < n; k++) yield* subsets(n, size, k + 1, [...chosen, k]);
}

/** Renames the string tokens `"from"` to `"to"` (the smallest subset that yields `expected`). */
export function renameInSchemaText(
  text: string,
  collection: string,
  from: string,
  to: string,
  expected: unknown,
): string | null {
  let lo = 0;
  let hi = text.length;
  try {
    const node = collectionNode(text, collection);
    if (node) [lo, hi] = [node.start, node.end];
  } catch {
    return null;
  }
  const tokens = stringTokens(text, from, lo, hi);
  if (tokens.length === 0 || tokens.length > MAX_RENAME_OCCURRENCES) return null;
  const replacement = JSON.stringify(to);
  for (let size = 1; size <= tokens.length; size++) {
    for (const pick of subsets(tokens.length, size)) {
      let out = text;
      for (const index of pick.toReversed()) {
        const [start, end] = tokens[index];
        out = out.slice(0, start) + replacement + out.slice(end);
      }
      if (verified(out, expected) !== null) return out;
    }
  }
  return null;
}

/** Removes the member `"key": <value>` with one adjacent comma and the whitespace that belonged to it. */
function removeMember(text: string, m: Member, siblings: Member[]): string {
  const isLast = siblings[siblings.length - 1] === m;
  const lineStart = text.lastIndexOf('\n', m.keyStart - 1) + 1;
  const aloneBefore = text.slice(lineStart, m.keyStart).trim() === '';
  if (!isLast) {
    let end = m.valEnd;
    while (/\s/.test(text[end] ?? '')) end++;
    end++; // the comma
    const lineEnd = text.indexOf('\n', end);
    const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
    if (aloneBefore && rest.trim() === '') return text.slice(0, lineStart) + text.slice(lineEnd + 1);
    while (text[end] === ' ' || text[end] === '\t') end++;
    return text.slice(0, m.keyStart) + text.slice(end);
  }
  if (siblings.length > 1) {
    let comma = m.keyStart - 1;
    while (/\s/.test(text[comma])) comma--;
    return text.slice(0, comma) + text.slice(m.valEnd);
  }
  const lineEnd = text.indexOf('\n', m.valEnd);
  const rest = text.slice(m.valEnd, lineEnd === -1 ? text.length : lineEnd);
  if (aloneBefore && rest.trim() === '' && lineEnd !== -1) return text.slice(0, lineStart) + text.slice(lineEnd + 1);
  return text.slice(0, m.keyStart) + text.slice(m.valEnd);
}

/** Removes `fields.<field>` of the collection, and `titleField` / `slugFrom` when they name the field. */
export function removeInSchemaText(text: string, collection: string, field: string, expected: unknown): string | null {
  try {
    let out = text;
    const steps: [string | null, string][] = [
      [null, field],
      ['titleField', field],
      ['slugFrom', field],
    ];
    for (const [prop, name] of steps) {
      const col = collectionNode(out, collection);
      const holder = prop === null ? member(col, 'fields')?.value : col;
      const target = member(holder, prop ?? name);
      if (!target || !holder?.members) {
        if (prop === null) return null;
        continue;
      }
      if (prop !== null) {
        const raw = out.slice(target.valStart, target.valEnd);
        if (JSON.parse(raw) !== name) continue;
      }
      out = removeMember(out, target, holder.members);
    }
    return verified(out, expected);
  } catch {
    return null;
  }
}
