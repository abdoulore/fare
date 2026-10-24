import { useEffect } from 'react';

import { StatusLine } from './components/StatusLine.tsx';
import { Link, useRoute, type Route } from './router.tsx';
import { How } from './pages/How.tsx';
import { Landing } from './pages/Landing.tsx';
import { Proof } from './pages/Proof.tsx';
import { Server } from './pages/Server.tsx';
import { Try } from './pages/Try.tsx';

const NAV: [Route, string][] = [
  ['/try', 'Try it'],
  ['/server', 'What the server sees'],
  ['/proof', 'Proof'],
  ['/how', 'How it works'],
];

const TITLES: Record<Route, string> = {
  '/': 'Fare',
  '/try': 'Try it · Fare',
  '/server': 'What the server sees · Fare',
  '/proof': 'Proof · Fare',
  '/how': 'How it works · Fare',
  'not-found': 'Not found · Fare',
};

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = TITLES[route];
  }, [route]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site">
        <div className="wrap">
          <Link to="/" className="wordmark" aria-label="Fare, home">
            <span className="mark" aria-hidden="true"><i /><i /></span>
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
        <div className="wrap">
          {route === '/' && <Landing />}
          {route === '/try' && <Try />}
          {route === '/server' && <Server />}
          {route === '/proof' && <Proof />}
          {route === '/how' && <How />}
          {route === 'not-found' && (
            <>
              <h1>Not found</h1>
              <p><Link to="/">Back to the start</Link></p>
            </>
          )}
        </div>
      </main>
      <footer className="site">
        <div className="wrap">
          <StatusLine />
          <p className="muted">Zcash testnet only. No analytics, no third-party requests. <a href="https://github.com/abdoulore/fare">Source</a></p>
        </div>
      </footer>
    </>
  );
}
