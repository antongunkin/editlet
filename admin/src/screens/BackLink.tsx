import type { Route } from '../route';
import { RouteLink } from '../RouteLink';
import { buttonVariants, cn, Icon } from '../ui';

/** The header's back button of a screen that has no entry above it: a link to `to` (*Back to Home*). */
export function BackLink({ to = { kind: 'home' }, title = 'Back to Home' }: { to?: Route; title?: string }) {
  return (
    <RouteLink
      to={to}
      className={cn(buttonVariants({ variant: 'ghost' }), 'size-11 px-0')}
      aria-label="Back"
      title={title}
    >
      <Icon name="chevron-left" size={20} />
    </RouteLink>
  );
}
