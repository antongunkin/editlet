import { PageTop } from './PageTop';

import { RouteLink } from '../RouteLink';

export function NotFound() {
  return (
    <section className="editlet-screen">
      <PageTop title="Not found" />
      <div className="editlet-card editlet-card--empty">
        <p className="editlet-u-text-muted">This page does not exist.</p>
        <RouteLink to="" className="editlet-link">
          Go to home
        </RouteLink>
      </div>
    </section>
  );
}
