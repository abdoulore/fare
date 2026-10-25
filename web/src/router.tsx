// Four routes on the History API, plus redirects for the paths the first version used.

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export const ROUTES = ['/', '/app', '/developers', '/proof'] as const;
export type Route = (typeof ROUTES)[number] | 'not-found';

/** Old paths and where they live now. */
export const REDIRECTS: Record<string, string> = {
  '/try': '/app',
  '/server': '/proof#ledger',
  '/how': '/proof#who-sees-what',
};

function resolve(): Route {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  const target = REDIRECTS[p];
  if (target) {
    window.history.replaceState(null, '', target);
    return resolve();
  }
  return (ROUTES as readonly string[]).includes(p) ? (p as Route) : 'not-found';
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(resolve);
  useEffect(() => {
    const on = () => setRoute(resolve());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  }, [route]);
  return route;
}

export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  const hash = to.split('#')[1];
  if (!hash) {
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus();
  }
}

export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} {...rest} />;
}
