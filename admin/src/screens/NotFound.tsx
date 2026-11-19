import { BackLink } from './BackLink';
import { StateView } from './StateView';

import { RouteLink } from '../RouteLink';
import { buttonVariants, cn } from '../ui';
import { Icon } from '../ui/primitives/icon';
import { useScreenChrome } from '../window/chrome';

/** A link the admin cannot resolve: one way out (FigCraft *Not found*). */
export function NotFound() {
  const chrome = useScreenChrome();
  return (
    <StateView
      title="Not found"
      page="header"
      back={<BackLink />}
      actions={chrome.windowActions}
      banners={chrome.banners}
      icon="search"
      heading="This page doesn't exist"
      text="The link may be old, or the entry was renamed or deleted."
      status={chrome.status}
    >
      <RouteLink
        to={{ kind: 'home' }}
        className={cn(buttonVariants({ variant: 'primary', size: 'lg', full: true }), 'no-underline')}
      >
        <Icon name="home" size={20} />
        Go to home
      </RouteLink>
    </StateView>
  );
}
