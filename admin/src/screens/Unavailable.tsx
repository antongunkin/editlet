import type { ReactNode } from 'react';

/** A full-page stop: the admin can't go on (not set up, no access, ...). `children` are the actions. */
export function Unavailable({ title, text, children }: { title: string; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="editlet-layout__sign-in">
      <div className="editlet-layout__sign-in-inner">
        <h1 className="editlet-layout__sign-in-title">{title}</h1>
        <p className="editlet-layout__sign-in-subtitle">{text}</p>
        {children ? <div className="editlet-unavailable__actions">{children}</div> : null}
      </div>
    </div>
  );
}
