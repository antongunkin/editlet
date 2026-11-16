import type { ReactNode } from 'react';

/** Page title row (copied from the old `octo-page-top` chrome) with an optional right-hand action slot. */
export function PageTop({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="editlet-page-top">
      <div className="editlet-page-top__title-area">
        <div className="editlet-page-top__title-row">
          <h1 className="editlet-page-top__title">{title}</h1>
        </div>
      </div>
      {children ? <div className="editlet-page-top__right">{children}</div> : null}
    </div>
  );
}
