/* oxlint-disable jsx-a11y/interactive-supports-focus -- roving tabindex: the focused control of the toolbar carries the focus */
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

import { Icon, LegacyIcon } from '../ui';

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
      icon: <LegacyIcon.Bold size={20} />,
      run: run(toggleStrongCommand),
      pressed: markActive(state, schema.marks.strong),
    },
    {
      key: 'italic',
      label: 'Italic',
      shortcut: `${MOD}I`,
      icon: <LegacyIcon.Italic size={20} />,
      run: run(toggleEmphasisCommand),
      pressed: markActive(state, schema.marks.emphasis),
    },
    {
      key: 'strike',
      label: 'Strikethrough',
      shortcut: `${MOD}${ALT}X`,
      icon: <LegacyIcon.Strikethrough size={20} />,
      run: run(toggleStrikethroughCommand),
      pressed: markActive(state, schema.marks.strike_through),
    },
    {
      key: 'code',
      label: 'Inline code',
      shortcut: `${MOD}E`,
      icon: <LegacyIcon.Code size={20} />,
      run: run(toggleInlineCodeCommand),
      pressed: markActive(state, schema.marks.inlineCode),
    },
    {
      key: 'link',
      label: 'Link',
      shortcut: `${MOD}K`,
      icon: <Icon name="link" size={20} />,
      run: onLink,
      pressed: markActive(state, schema.marks.link),
    },
    {
      key: 'bullet',
      label: 'Bulleted list',
      shortcut: `${MOD}${ALT}8`,
      icon: <Icon name="list" size={20} />,
      run: run(wrapInBulletListCommand),
      pressed: inNode(state, schema.nodes.bullet_list),
    },
    {
      key: 'ordered',
      label: 'Numbered list',
      shortcut: `${MOD}${ALT}7`,
      icon: <LegacyIcon.ListOrdered size={20} />,
      run: run(wrapInOrderedListCommand),
      pressed: inNode(state, schema.nodes.ordered_list),
    },
    {
      key: 'quote',
      label: 'Quote',
      shortcut: `${MOD}⇧B`,
      icon: <LegacyIcon.Quote size={20} />,
      run: run(wrapInBlockquoteCommand),
      pressed: inNode(state, schema.nodes.blockquote),
    },
    {
      key: 'codeblock',
      label: 'Code block',
      shortcut: `${MOD}${ALT}C`,
      icon: <LegacyIcon.CodeBlock size={20} />,
      run: run(createCodeBlockCommand),
      pressed: kind === 'code',
    },
    {
      key: 'image',
      label: selectedImage(state) ? 'Edit image' : 'Image',
      icon: <Icon name="image" size={20} />,
      run: onImage,
    },
    {
      key: 'table',
      label: 'Table',
      icon: <Icon name="table" size={20} />,
      run: run(insertTableCommand, { row: 3, col: 3 }),
    },
    { key: 'hr', label: 'Divider', icon: <Icon name="minus" size={20} />, run: run(insertHrCommand) },
  ];
  if (inTable) {
    tools.push(
      {
        key: 'row',
        label: 'Add row',
        icon: <span className="px-1 text-xs font-medium">+ Row</span>,
        run: run(addRowAfterCommand),
      },
      {
        key: 'col',
        label: 'Add column',
        icon: <span className="px-1 text-xs font-medium">+ Col</span>,
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
    // FigCraft `Toolbar/format`: one row that scrolls sideways (the last tool is cut at the edge), every tool a 44 px
    // target; a tool that is on is a raised white tile.
    <div
      className="flex items-center gap-1 overflow-x-auto overscroll-x-contain bg-background px-4 py-1"
      role="toolbar"
      aria-label="Formatting"
      onKeyDown={onKeyDown}
    >
      <span className="relative inline-flex shrink-0 items-center">
        <select
          ref={(el) => {
            refs.current[0] = el;
          }}
          className="h-11 cursor-pointer appearance-none rounded-full border-0 bg-card pr-10 pl-4 font-sans text-base font-medium text-foreground shadow-raised outline-none focused:inset-ring-2 focused:inset-ring-ring"
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
        <Icon name="chevron-down" size={16} className="pointer-events-none absolute right-4 text-muted-foreground" />
      </span>
      {tools.map((tool, i) => (
        <button
          key={tool.key}
          ref={(el) => {
            refs.current[i + 1] = el;
          }}
          type="button"
          className="inline-flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent p-0 text-foreground outline-none hovered:bg-accent aria-pressed:bg-card aria-pressed:shadow-raised focused:inset-ring-2 focused:inset-ring-ring"
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
