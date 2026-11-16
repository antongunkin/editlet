/**
 * Best-effort shell tokenizer: splits a command line into simple commands (on `&&`, `||`, `;`, `|`, `&` and
 * newlines) and each command into words, honouring `'…'`, `"…"` and backslash escapes. Not a shell parser.
 */
export function splitCommands(command: string): string[][] {
  const commands: string[][] = [];
  const nested: string[][] = [];

  /** Scans `$( … )` / `` `…` `` at `i`; the inner text is split as separate commands. Returns the end index. */
  const substitution = (i: number): number | null => {
    let end: number;
    if (command[i] === '`') {
      end = i + 1;
      while (end < command.length && command[end] !== '`') end += command[end] === '\\' ? 2 : 1;
    } else if (command[i] === '$' && command[i + 1] === '(') {
      let depth = 1;
      end = i + 2;
      for (; end < command.length; end++) {
        if (command[end] === '(') depth++;
        else if (command[end] === ')' && --depth === 0) break;
      }
    } else return null;
    const stop = Math.min(end, command.length);
    nested.push(...splitCommands(command.slice(i + (command[i] === '`' ? 1 : 2), stop)));
    return stop;
  };
  let words: string[] = [];
  let word = '';
  let inWord = false;

  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const sub = ch === '$' || ch === '`' ? substitution(i) : null;
    if (sub !== null) {
      inWord = true;
      i = sub;
    } else if (ch === '\\') {
      if (command[i + 1] === '\n') i++; // line continuation
      else if (i + 1 < command.length) {
        word += command[++i];
        inWord = true;
      }
    } else if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      word += command.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (ch === '"') {
      inWord = true;
      for (i++; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === '\\' && i + 1 < command.length) i++;
        else {
          const inner = command[i] === '$' || command[i] === '`' ? substitution(i) : null;
          if (inner !== null) {
            i = inner;
            continue;
          }
        }
        word += command[i];
      }
    } else if (ch === ' ' || ch === '\t') {
      endWord();
    } else if (ch === '\n' || ch === ';' || ch === '|' || ch === '(' || ch === ')') {
      endCommand();
    } else if (ch === '&') {
      // `2>&1`, `&>file`: part of a redirection, not a command separator.
      if (word.endsWith('>') || word.endsWith('<') || command[i + 1] === '>') {
        word += ch;
        inWord = true;
      } else {
        endCommand();
      }
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return [...commands, ...nested];
}
