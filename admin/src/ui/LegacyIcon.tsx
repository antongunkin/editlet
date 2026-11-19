/**
 * The vendored Lucide icons (ISC) the design has no icon for yet (`design/tokens.json` → `icon`): chevron-up, sun, the
 * text-format ones of the rich-text toolbar. Everything else is `Icon` (primitives/icon.tsx), drawn from the generated
 * `icons.ts`. Delete an entry when the design gets its icon and the call site moves; delete this file when none is left.
 */
import { createElement, forwardRef } from 'react';
import type { SVGProps } from 'react';

type IconNode = ReadonlyArray<readonly [string, Record<string, string | number>]>;

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'color'> & {
  color?: string;
  size?: number | string;
  strokeWidth?: number | string;
};

const DEFAULT_ATTRIBUTES = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function hasA11yProp(props: SVGProps<SVGSVGElement>): boolean {
  return 'aria-label' in props || 'aria-labelledby' in props || 'role' in props;
}

function createIcon(iconName: string, iconNode: IconNode) {
  const IconComponent = forwardRef<SVGSVGElement, IconProps>(
    ({ color, size, strokeWidth, className, children, ...rest }, ref) => {
      const resolvedSize = size ?? DEFAULT_ATTRIBUTES.width;
      return createElement(
        'svg',
        {
          ref,
          ...DEFAULT_ATTRIBUTES,
          width: resolvedSize,
          height: resolvedSize,
          stroke: color ?? DEFAULT_ATTRIBUTES.stroke,
          strokeWidth: strokeWidth ?? DEFAULT_ATTRIBUTES.strokeWidth,
          className: className || undefined,
          'data-icon': iconName,
          ...(!children && !hasA11yProp(rest) ? { 'aria-hidden': 'true' } : {}),
          ...rest,
        },
        [
          ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
          ...(Array.isArray(children) ? children : [children]),
        ],
      );
    },
  );
  IconComponent.displayName = iconName;
  return IconComponent;
}

const ChevronUp = createIcon('chevron-up', [['path', { d: 'm18 15-6-6-6 6', key: '153udz' }]]);
const Sun = createIcon('sun', [
  ['circle', { cx: '12', cy: '12', r: '4', key: 'sn0' }],
  ['path', { d: 'M12 2v2', key: 'sn1' }],
  ['path', { d: 'M12 20v2', key: 'sn2' }],
  ['path', { d: 'm4.93 4.93 1.41 1.41', key: 'sn3' }],
  ['path', { d: 'm17.66 17.66 1.41 1.41', key: 'sn4' }],
  ['path', { d: 'M2 12h2', key: 'sn5' }],
  ['path', { d: 'M20 12h2', key: 'sn6' }],
  ['path', { d: 'm6.34 17.66-1.41 1.41', key: 'sn7' }],
  ['path', { d: 'm19.07 4.93-1.41 1.41', key: 'sn8' }],
]);
const Bold = createIcon('bold', [
  ['path', { d: 'M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8', key: 'bold1' }],
]);
const Italic = createIcon('italic', [
  ['line', { x1: '19', x2: '10', y1: '4', y2: '4', key: 'it1' }],
  ['line', { x1: '14', x2: '5', y1: '20', y2: '20', key: 'it2' }],
  ['line', { x1: '15', x2: '9', y1: '4', y2: '20', key: 'it3' }],
]);
const Strikethrough = createIcon('strikethrough', [
  ['path', { d: 'M16 4H9a3 3 0 0 0-2.83 4', key: 'st1' }],
  ['path', { d: 'M14 12a4 4 0 0 1 0 8H6', key: 'st2' }],
  ['line', { x1: '4', x2: '20', y1: '12', y2: '12', key: 'st3' }],
]);
const Code = createIcon('code', [
  ['path', { d: 'm16 18 6-6-6-6', key: 'co1' }],
  ['path', { d: 'm8 6-6 6 6 6', key: 'co2' }],
]);
const ListOrdered = createIcon('list-ordered', [
  ['path', { d: 'M10 6h11', key: 'lo1' }],
  ['path', { d: 'M10 12h11', key: 'lo2' }],
  ['path', { d: 'M10 18h11', key: 'lo3' }],
  ['path', { d: 'M4 6h1v4', key: 'lo4' }],
  ['path', { d: 'M4 10h2', key: 'lo5' }],
  ['path', { d: 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1', key: 'lo6' }],
]);
const Quote = createIcon('text-quote', [
  ['path', { d: 'M17 6H3', key: 'qu1' }],
  ['path', { d: 'M21 12H8', key: 'qu2' }],
  ['path', { d: 'M21 18H8', key: 'qu3' }],
  ['path', { d: 'M3 12v6', key: 'qu4' }],
]);
const CodeBlock = createIcon('square-code', [
  ['path', { d: 'm10 9-3 3 3 3', key: 'cb1' }],
  ['path', { d: 'm14 15 3-3-3-3', key: 'cb2' }],
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', key: 'cb3' }],
]);

export const LegacyIcon = {
  ChevronUp,
  Sun,
  Bold,
  Italic,
  Strikethrough,
  Code,
  ListOrdered,
  Quote,
  CodeBlock,
} as const;
