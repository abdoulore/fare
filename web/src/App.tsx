import { useEffect } from 'react';

import { Mark } from './components/Mark.tsx';
import { StatusLine } from './components/StatusLine.tsx';
import { Developers } from './pages/Developers.tsx';
import { Home } from './pages/Home.tsx';
import { Proof } from './pages/Proof.tsx';
import { Use } from './pages/Use.tsx';
import { Link, useRoute, type Route } from './router.tsx';

const NAV: [Route, string][] = [
  ['/app', 'App'],
  ['/developers', 'Developers'],
  ['/proof', 'Proof'],
];

const TITLES: Record<Route, string> = {
  '/': 'Fare: private pay-per-call for APIs',
  '/app': 'App · Fare',
  '/developers': 'Developers · Fare',
  '/proof': 'Proof · Fare',
  'not-found': 'Not found · Fare',
};

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = TITLES[route];
  }, [route]);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site">
        <div className="wrap">
          <Link to="/" className="mark" aria-label="Fare, home">
            <Mark />
            Fare
          </Link>
          <nav className="main" aria-label="Main">
            {NAV.map(([to, label]) => (
              <Link key={to} to={to} aria-current={route === to ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {route === '/' && <Home />}
        {route === '/app' && <Use />}
        {route === '/developers' && <Developers />}
        {route === '/proof' && <Proof />}
        {route === 'not-found' && (
          <div className="wrap doc-head">
            <h1>Not found</h1>
            <p>
              <Link to="/">Back to the start</Link>
            </p>
          </div>
        )}
      </main>
      <footer className="site">
        <div className="wrap">
          <StatusLine />
          <p>
            Zcash testnet only: TAZ has no value. No analytics, no third-party requests. <a href="https://github.com/abdoulore/fare">Source on GitHub</a>
          </p>
        </div>
      </footer>
    </>
  );
}
