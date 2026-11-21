import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import logo from '../../../assets/logo.svg';
import { config } from '../config';
import { copy, NOT_AFFILIATED, RISK_LABEL, RISK_NOTICE } from '../content/copy';
import { explorer } from '../lib/explorer';
import { Ext } from './bits';

const t = copy.layout;
const NAV = [
  ['/play', t.nav.play],
  ['/live', t.nav.live],
  ['/practice', t.nav.practice],
  ['/library', t.nav.library],
  ['/fairness', t.nav.fairness],
] as const;

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#main">
        {t.skip}
      </a>
      <header className="site-header">
        {config.mock && (
          <div className="demo-banner" role="note">
            <strong className="demo-label">{t.demoLabel}</strong> {t.demoBanner}
          </div>
        )}
        <div className="wrap header-row">
          <Link to="/" className="brand" aria-label={t.homeLabel}>
            <img src={logo} alt="" width="32" height="32" />
            <span>TURNCOAT</span>
          </Link>
          <nav aria-label={copy.common.navLabel}>
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
            <strong>{RISK_LABEL}</strong> {RISK_NOTICE}
          </p>
          <p>{NOT_AFFILIATED}</p>
          <p className="footer-links">
            <Ext href={explorer.contract()} missing={t.contractMissing}>
              {t.contractLink}
            </Ext>
          </p>
        </div>
      </footer>
    </>
  );
}
