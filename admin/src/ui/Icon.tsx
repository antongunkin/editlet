/**
 * Vendored icon nodes (ISC, Lucide). Only the icons the admin uses.
 * Copied from the old `octocms/components/ui/Icon/Icon.tsx`.
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

const Plus = createIcon('plus', [
  ['path', { d: 'M5 12h14', key: '1ays0h' }],
  ['path', { d: 'M12 5v14', key: 's699le' }],
]);

const X = createIcon('x', [
  ['path', { d: 'M18 6 6 18', key: '1bl5f8' }],
  ['path', { d: 'm6 6 12 12', key: 'd8bk6v' }],
]);

const Check = createIcon('check', [['path', { d: 'M20 6 9 17l-5-5', key: '1gmf2c' }]]);

const Trash = createIcon('trash-2', [
  ['path', { d: 'M10 11v6', key: 'nco0om' }],
  ['path', { d: 'M14 11v6', key: 'outv1u' }],
  ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', key: 'miytrc' }],
  ['path', { d: 'M3 6h18', key: 'd0wm0j' }],
  ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', key: 'e791ji' }],
]);

const Image = createIcon('image', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2', key: '1m3agn' }],
  ['circle', { cx: '9', cy: '9', r: '2', key: 'af1f0g' }],
  ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21', key: '1xmnt7' }],
]);

const Calendar = createIcon('calendar', [
  ['path', { d: 'M8 2v4', key: 'cal1' }],
  ['path', { d: 'M16 2v4', key: 'cal2' }],
  ['rect', { width: '18', height: '18', x: '3', y: '4', rx: '2', key: 'cal3' }],
  ['path', { d: 'M3 10h18', key: 'cal4' }],
]);

const ZoomIn = createIcon('zoom-in', [
  ['circle', { cx: '11', cy: '11', r: '8', key: 'zi1' }],
  ['path', { d: 'm21 21-4.3-4.3', key: 'zi2' }],
  ['path', { d: 'M11 8v6', key: 'zi3' }],
  ['path', { d: 'M8 11h6', key: 'zi4' }],
]);

const Upload = createIcon('upload', [
  ['path', { d: 'M12 3v12', key: '1x0j5s' }],
  ['path', { d: 'm17 8-5-5-5 5', key: '7q97r8' }],
  ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', key: 'ih7n3h' }],
]);

const ExternalLink = createIcon('external-link', [
  ['path', { d: 'M15 3h6v6', key: '1q9fwt' }],
  ['path', { d: 'M10 14 21 3', key: 'gplh6r' }],
  ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', key: 'a6xqqp' }],
]);

const ArrowLeft = createIcon('arrow-left', [
  ['path', { d: 'm12 19-7-7 7-7', key: '1l729n' }],
  ['path', { d: 'M19 12H5', key: 'x3x0zl' }],
]);

const ChevronRight = createIcon('chevron-right', [['path', { d: 'm9 18 6-6-6-6', key: 'mthhwq' }]]);

const ChevronLeft = createIcon('chevron-left', [['path', { d: 'm15 18-6-6 6-6', key: '1wnfg3' }]]);

const ChevronUp = createIcon('chevron-up', [['path', { d: 'm18 15-6-6-6 6', key: '153udz' }]]);

const File = createIcon('file', [
  ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', key: '1rqfz7' }],
  ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4', key: 'tnqrlb' }],
]);

const Folder = createIcon('folder', [
  [
    'path',
    {
      d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
      key: '1kt360',
    },
  ],
]);

const Eye = createIcon('eye', [
  [
    'path',
    {
      d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
      key: '1nclc0',
    },
  ],
  ['circle', { cx: '12', cy: '12', r: '3', key: '1v7zrd' }],
]);

const Home = createIcon('house', [
  ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', key: '5wwlr5' }],
  [
    'path',
    {
      d: 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
      key: '1d0kgt',
    },
  ],
]);

const ChevronDown = createIcon('chevron-down', [['path', { d: 'm6 9 6 6 6-6', key: 'qrunsl' }]]);

/** Four arrows: the "move" icon (the same shape as the system move cursor). */
const Move = createIcon('move', [
  ['path', { d: 'M12 2v20', key: 'mv1' }],
  ['path', { d: 'M2 12h20', key: 'mv2' }],
  ['path', { d: 'm15 19-3 3-3-3', key: 'mv3' }],
  ['path', { d: 'm19 9 3 3-3 3', key: 'mv4' }],
  ['path', { d: 'm5 9-3 3 3 3', key: 'mv5' }],
  ['path', { d: 'm9 5 3-3 3 3', key: 'mv6' }],
]);

const Minimize = createIcon('minimize-2', [
  ['path', { d: 'm14 10 7-7', key: 'oa77jy' }],
  ['path', { d: 'M20 10h-6V4', key: 'mjg0md' }],
  ['path', { d: 'm3 21 7-7', key: 'tjx5ai' }],
  ['path', { d: 'M4 14h6v6', key: 'rmj7iw' }],
]);

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

const Moon = createIcon('moon', [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', key: 'mn1' }]]);

const Pencil = createIcon('pencil', [
  [
    'path',
    {
      d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
      key: 'pe1',
    },
  ],
  ['path', { d: 'm15 5 4 4', key: 'pe2' }],
]);

const Undo = createIcon('undo-2', [
  ['path', { d: 'M9 14 4 9l5-5', key: 'u1' }],
  ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11', key: 'u2' }],
]);

const Alert = createIcon('triangle-alert', [
  ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', key: 'wmoenq' }],
  ['path', { d: 'M12 9v4', key: 'juzpu7' }],
  ['path', { d: 'M12 17h.01', key: 'p32p05' }],
]);

const GitBranch = createIcon('git-branch', [
  ['line', { x1: '6', x2: '6', y1: '3', y2: '15', key: 'zgfqzp' }],
  ['circle', { cx: '18', cy: '6', r: '3', key: '1h7g24' }],
  ['circle', { cx: '6', cy: '18', r: '3', key: 'fqmcym' }],
  ['path', { d: 'M18 9a9 9 0 0 1-9 9', key: 'n2h4wq' }],
]);

const LogOut = createIcon('log-out', [
  ['path', { d: 'm16 17 5-5-5-5', key: '1bji2h' }],
  ['path', { d: 'M21 12H9', key: 'dn1m92' }],
  ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', key: '1uf3rs' }],
]);

// Rich-text toolbar (P18).
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

const Link = createIcon('link', [
  ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', key: 'ln1' }],
  ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', key: 'ln2' }],
]);

const List = createIcon('list', [
  ['path', { d: 'M3 6h.01', key: 'li1' }],
  ['path', { d: 'M3 12h.01', key: 'li2' }],
  ['path', { d: 'M3 18h.01', key: 'li3' }],
  ['path', { d: 'M8 6h13', key: 'li4' }],
  ['path', { d: 'M8 12h13', key: 'li5' }],
  ['path', { d: 'M8 18h13', key: 'li6' }],
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

const Minus = createIcon('minus', [['path', { d: 'M5 12h14', key: 'mi1' }]]);

const Table = createIcon('table', [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', key: 'tb1' }],
  ['path', { d: 'M12 3v18', key: 'tb2' }],
  ['path', { d: 'M3 9h18', key: 'tb3' }],
  ['path', { d: 'M3 15h18', key: 'tb4' }],
]);

export const Icon = {
  Plus,
  X,
  Check,
  Trash,
  Image,
  Calendar,
  Upload,
  ZoomIn,
  ExternalLink,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  File,
  Folder,
  Eye,
  Home,
  ChevronDown,
  Move,
  Minimize,
  Sun,
  Moon,
  Undo,
  Pencil,
  Alert,
  GitBranch,
  LogOut,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  List,
  ListOrdered,
  Quote,
  CodeBlock,
  Minus,
  Table,
} as const;
