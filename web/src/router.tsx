// A five-route router on the History API. No dependency, no hash.

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export const ROUTES = ['/', '/try', '/server', '/proof', '/how'] as const;
export type Route = (typeof ROUTES)[number] | 'not-found';

function current(): Route {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  return (ROUTES as readonly string[]).includes(p) ? (p as Route) : 'not-found';
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const on = () => setRoute(current());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}

export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
  document.getElementById('main')?.focus();
}

export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} {...rest} />;
}
