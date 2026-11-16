import { PageTop } from './PageTop';

/** A screen that a later version fills in (content model, branch preview). */
export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="editlet-screen">
      <PageTop title={title} />
      <div className="editlet-card editlet-card--empty">
        <p className="editlet-u-text-muted">{text}</p>
      </div>
    </section>
  );
}
