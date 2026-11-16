import type { AnchorHTMLAttributes, MouseEvent } from 'react';

import { formatRoute, type Route } from './route';
import { useRoute } from './useRoute';

import { withEditletRoute } from '../../loader/protocol';

export type RouteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: Route | string };

/** A real `?editlet=` link (so open-in-new-tab works) whose plain click navigates in place. */
export function RouteLink({ to, onClick, children, ...props }: RouteLinkProps) {
  const { navigate } = useRoute();
  const raw = typeof to === 'string' ? to : formatRoute(to);
  const href = withEditletRoute(window.location.href, raw);
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(raw);
  };
  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
