import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import logo from '../../../assets/logo.svg';
import { config } from '../config';
import { NOT_AFFILIATED, RISK_NOTICE } from '../content/copy';
import { Ext } from './bits';
import { explorer } from '../lib/explorer';

const NAV = [
  ['/live', 'Live'],
  ['/practice', 'Practice'],
  ['/library', 'Library'],
  ['/fairness', 'Fairness'],
] as const;

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      {config.mock && (
        <div className="demo-banner" role="note">
          Demo data. Not a real round, and none of these numbers are real.
        </div>
      )}
      <header className="site-header">
        <div className="wrap header-row">
          <Link to="/" className="brand" aria-label="Turncoat home">
            <img src={logo} alt="" width="32" height="32" />
            <span>TURNCOAT</span>
          </Link>
          <nav aria-label="Main">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="wrap">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <p className="risk">
            <strong>Risk notice.</strong> {RISK_NOTICE}
          </p>
          <p>{NOT_AFFILIATED}</p>
          <p className="footer-links">
            <Ext href={explorer.contract()} missing="Contract address: added at deployment.">
              Contract on BscScan
            </Ext>
          </p>
        </div>
      </footer>
    </>
  );
}
