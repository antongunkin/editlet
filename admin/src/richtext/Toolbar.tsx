import type { CmdKey, Editor } from '@milkdown/core';
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark';
import {
  addColAfterCommand,
  addRowAfterCommand,
  insertTableCommand,
  toggleStrikethroughCommand,
} from '@milkdown/preset-gfm';
import type { EditorState } from '@milkdown/prose/state';
import { callCommand } from '@milkdown/utils';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { blockKind, inNode, markActive, selectedImage } from './commands';

import { Icon } from '../ui';

/** `Mod` as the platform shows it. */
const MOD = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const ALT = MOD === '⌘' ? '⌥' : 'Alt+';

type Tool = {
  key: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  run(): void;
  /** Toggle buttons report their state with `aria-pressed`. */
  pressed?: boolean;
};

const BLOCKS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
];

/**
 * The formatting toolbar: a block type select, then toggle and insert buttons. One tab stop; arrow keys, Home and End
 * move between the controls (roving tabindex).
 */
export function Toolbar({
  editor,
  state,
  onLink,
  onImage,
}: {
  editor: Editor;
  state: EditorState;
  onLink(): void;
  onImage(): void;
}) {
  const [focus, setFocus] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const { schema } = state;
  const run =
    <T,>(cmd: { key: CmdKey<T> }, payload?: T) =>
    () =>
      editor.action(callCommand(cmd.key, payload));
  const kind = blockKind(state);
  const inTable = inNode(state, schema.nodes.table);

  const tools: Tool[] = [
    {
      key: 'bold',
      label: 'Bold',
      shortcut: `${MOD}B`,
      icon: <Icon.Bold size={16} />,
      run: run(toggleStrongCommand),
      pressed: markActive(state, schema.marks.strong),
    },
    {
      key: 'italic',
      label: 'Italic',
      shortcut: `${MOD}I`,
      icon: <Icon.Italic size={16} />,
      run: run(toggleEmphasisCommand),
      pressed: markActive(state, schema.marks.emphasis),
    },
    {
      key: 'strike',
      label: 'Strikethrough',
      shortcut: `${MOD}${ALT}X`,
      icon: <Icon.Strikethrough size={16} />,
      run: run(toggleStrikethroughCommand),
      pressed: markActive(state, schema.marks.strike_through),
    },
    {
      key: 'code',
      label: 'Inline code',
      shortcut: `${MOD}E`,
      icon: <Icon.Code size={16} />,
      run: run(toggleInlineCodeCommand),
      pressed: markActive(state, schema.marks.inlineCode),
    },
    {
      key: 'link',
      label: 'Link',
      shortcut: `${MOD}K`,
      icon: <Icon.Link size={16} />,
      run: onLink,
      pressed: markActive(state, schema.marks.link),
    },
    {
      key: 'bullet',
      label: 'Bulleted list',
      shortcut: `${MOD}${ALT}8`,
      icon: <Icon.List size={16} />,
      run: run(wrapInBulletListCommand),
      pressed: inNode(state, schema.nodes.bullet_list),
    },
    {
      key: 'ordered',
      label: 'Numbered list',
      shortcut: `${MOD}${ALT}7`,
      icon: <Icon.ListOrdered size={16} />,
      run: run(wrapInOrderedListCommand),
      pressed: inNode(state, schema.nodes.ordered_list),
    },
    {
      key: 'quote',
      label: 'Quote',
      shortcut: `${MOD}⇧B`,
      icon: <Icon.Quote size={16} />,
      run: run(wrapInBlockquoteCommand),
      pressed: inNode(state, schema.nodes.blockquote),
    },
    {
      key: 'codeblock',
      label: 'Code block',
      shortcut: `${MOD}${ALT}C`,
      icon: <Icon.CodeBlock size={16} />,
      run: run(createCodeBlockCommand),
      pressed: kind === 'code',
    },
    {
      key: 'image',
      label: selectedImage(state) ? 'Edit image' : 'Image',
      icon: <Icon.Image size={16} />,
      run: onImage,
    },
    { key: 'table', label: 'Table', icon: <Icon.Table size={16} />, run: run(insertTableCommand, { row: 3, col: 3 }) },
    { key: 'hr', label: 'Divider', icon: <Icon.Minus size={16} />, run: run(insertHrCommand) },
  ];
  if (inTable) {
    tools.push(
      {
        key: 'row',
        label: 'Add row',
        icon: <span className="editlet-rt-toolbar__text">+ Row</span>,
        run: run(addRowAfterCommand),
      },
      {
        key: 'col',
        label: 'Add column',
        icon: <span className="editlet-rt-toolbar__text">+ Col</span>,
        run: run(addColAfterCommand),
      },
    );
  }
  const count = tools.length + 1;
  const current = Math.min(focus, count - 1);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: count - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = (next + count) % count;
    setFocus(i);
    refs.current[i]?.focus();
  };

  const setBlock = (value: string) => {
    if (value === 'paragraph') editor.action(callCommand(turnIntoTextCommand.key));
    else editor.action(callCommand(wrapInHeadingCommand.key, Number(value.slice(1))));
  };

  return (
    <div className="editlet-rt-toolbar" role="toolbar" aria-label="Formatting" onKeyDown={onKeyDown}>
      <select
        ref={(el) => {
          refs.current[0] = el;
        }}
        className="editlet-rt-toolbar__select"
        aria-label="Block type"
        tabIndex={current === 0 ? 0 : -1}
        value={BLOCKS.some((b) => b.value === kind) ? kind : ''}
        onFocus={() => setFocus(0)}
        onChange={(e) => setBlock(e.target.value)}
      >
        {BLOCKS.some((b) => b.value === kind) ? null : <option value="">—</option>}
        {BLOCKS.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </select>
      {tools.map((tool, i) => (
        <button
          key={tool.key}
          ref={(el) => {
            refs.current[i + 1] = el;
          }}
          type="button"
          className="editlet-rt-toolbar__button"
          tabIndex={current === i + 1 ? 0 : -1}
          aria-label={tool.label}
          aria-pressed={tool.pressed}
          title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
          // Keep the editor's selection: a click must not move focus out before the command runs.
          onMouseDown={(e) => e.preventDefault()}
          onFocus={() => setFocus(i + 1)}
          onClick={tool.run}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
