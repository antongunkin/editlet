import type { ElementType, ReactNode } from 'react';

import { UseRow } from './UseRow';

import { Input } from '../ui';
import { Card } from '../ui/parts/card';

export interface MediaUseItem {
  key: string | number;
  /** The entry's title and where in it (*Post · Cover image*). */
  title: ReactNode;
  sub: ReactNode;
  /** The link's props (`to` for a `RouteLink`). */
  link?: Record<string, unknown>;
  /** The alt text typed in this place, and what names its input for assistive technology. */
  alt: string;
  altLabel: string;
  onAlt?(alt: string): void;
}

export interface MediaUsesProps {
  /** *Used in 1 place* or *Not used*. */
  heading: string;
  items: MediaUseItem[];
  /** What to say when there are no uses. */
  empty?: ReactNode;
  /** The link element of the rows: `RouteLink` in the admin. */
  linkAs?: ElementType;
}

/** Where an image is used (FigCraft *Media · image*): a row to the entry and the alt text of that place under it. */
export function MediaUses({ heading, items, empty, linkAs }: MediaUsesProps) {
  return (
    <section aria-label="Where it is used" className="flex flex-col gap-3">
      <h2 className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">{heading}</h2>
      {items.length === 0 ? (
        <p className="m-0 px-1 text-base text-tray-muted-foreground">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {items.map((item) => {
            const id = `editlet-media-alt-${item.key}`;
            return (
              <li key={item.key} className="flex flex-col gap-2">
                <Card>
                  <UseRow as={linkAs} title={item.title} sub={item.sub} {...item.link} />
                </Card>
                <label htmlFor={id} className="px-1 text-sm font-medium text-tray-muted-foreground">
                  Alt text
                </label>
                <Input
                  id={id}
                  value={item.alt}
                  placeholder="No alt text"
                  aria-label={item.altLabel}
                  onChange={(e) => item.onAlt?.(e.target.value)}
                  readOnly={item.onAlt === undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
