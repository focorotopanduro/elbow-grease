import { useEffect, useState } from 'react';
import {
  CLIENT_PATHS,
  getClientPath,
  type ClientPathId,
} from '../data/clientPaths';
import { useClientPath } from '../hooks/useClientPath';
import { track } from '../lib/analytics';
import './Nav.css';

const ON_HOME = typeof window !== 'undefined' &&
  (window.location.pathname === '/' || window.location.pathname === '/index.html');

const home = (hash: string) => (ON_HOME ? hash : `/${hash}`);

const LINKS = [
  { href: home('#services'), label: 'Services', id: 'services' },
  { href: home('#about'), label: 'About', id: 'about' },
  // Hurricane uplift sim is on the back burner — link removed from
  // the public nav. The page + visualizer source stay intact under
  // /src/HurricaneUpliftPage.tsx + /src/components/WindUpliftVisualizer/
  // for when we're ready to ship it. To restore: re-add this link,
  // re-add the sitemap entry, re-add the vite.config rollup input.
  // { href: '/hurricane-uplift.html', label: 'Wind Tool', id: 'hurricane', external: true },
  { href: home('#contact'), label: 'Contact', id: 'contact' },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [pastBanner, setPastBanner] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>('home');
  const [progress, setProgress] = useState(0);
  const { path, selectPath: commitClientPath } = useClientPath({ mirrorToDocument: true });
  const clientPath = path ?? getClientPath();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 60);
      setPastBanner(y > 24);
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      setProgress(Math.min(1, Math.max(0, y / max)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const ids = ['home', 'smart-path', 'services', 'about', 'contact'];
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio > 0.4) setActive(e.target.id);
        });
      },
      { threshold: [0.4, 0.6], rootMargin: '-20% 0px -40% 0px' },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) document.body.dataset.navOpen = 'true';
    else delete document.body.dataset.navOpen;
    return () => {
      document.body.style.overflow = '';
      delete document.body.dataset.navOpen;
    };
  }, [open]);

  const selectPath = (id: ClientPathId, placement: 'nav_desktop' | 'nav_mobile') => {
    const next = getClientPath(id);
    commitClientPath(id, placement);
    track('cta_click', {
      cta: 'client_path_select',
      placement,
      path: id,
      intent: next.analyticsIntent,
      priority: next.priority,
    });
    setOpen(false);
    window.setTimeout(() => {
      const target = document.getElementById('smart-path');
      if (!target) return;
      const navBottom = document.querySelector('.nav')?.getBoundingClientRect().bottom ?? 80;
      const top = window.scrollY + target.getBoundingClientRect().top - navBottom - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 80);
  };

  return (
    <header className={`nav ${scrolled ? 'nav--scrolled' : ''} ${pastBanner ? 'nav--past-banner' : ''}`}>
      <div className="nav__inner container">
        <a href="#home" className="nav__brand" aria-label="Beit Building Contractors home">
          <span className="nav__brand-mark">
            <picture>
              <source srcSet="/logo-mark.webp" type="image/webp" />
              <img src="/logo-mark.png" alt="" width="56" height="56" />
            </picture>
          </span>
          <span className="nav__brand-text">
            <span className="nav__brand-name">Beit Building</span>
            <span className="nav__brand-sub">
              <span className="nav__brand-tick" aria-hidden="true" />
              Contractors LLC
            </span>
          </span>
        </a>

        <nav className="nav-desktop" aria-label="Primary">
          <ul>
            {LINKS.map((l, i) => (
              <li key={i}>
                <a
                  href={l.href}
                  className={`${active === l.id ? 'is-active' : ''} ${l.id === 'hurricane' ? 'nav-desktop__tool' : ''}`}
                  aria-current={active === l.id ? 'page' : undefined}
                >
                  {l.label}
                  {l.id === 'hurricane' && <span className="nav-desktop__tool-dot" aria-hidden="true" />}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={`nav-path ${active === 'smart-path' ? 'is-active' : ''}`}>
          <a href={home('#smart-path')} className="nav-path__trigger" aria-label={`Current project path: ${clientPath.label}`}>
            <span className="nav-path__kicker">Route</span>
            <strong>{clientPath.shortLabel}</strong>
            <span className="nav-path__chevron" aria-hidden="true" />
          </a>
          <div className="nav-path__panel" aria-label="Project path options">
            {CLIENT_PATHS.map((path) => (
              <button
                key={path.id}
                type="button"
                className={`nav-path__option ${clientPath.id === path.id ? 'is-selected' : ''}`}
                onClick={() => selectPath(path.id, 'nav_desktop')}
              >
                <span>{path.shortLabel}</span>
                <small>{path.label}</small>
              </button>
            ))}
          </div>
        </div>

        <a href="tel:+14079426459" className="nav__phone" aria-label="Call (407) 942-6459">
          <span className="nav__phone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </span>
          <span className="nav__phone-text">(407) 942-6459</span>
        </a>

        <a href="#contact" className="btn btn--primary nav__cta">
          Free Estimate
        </a>

        <button
          className={`nav-hamburger ${open ? 'nav-hamburger--open' : ''}`}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
      </div>

      <span
        className="nav__progress"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />

      <div className={`nav-mobile ${open ? 'nav-mobile--open' : ''}`} aria-hidden={!open}>
        <ul>
          <li>
            <a href={home('#smart-path')} onClick={() => setOpen(false)}>Pathways</a>
          </li>
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
            </li>
          ))}
          <li className="nav-mobile__paths" aria-label="Choose project path">
            <span className="nav-mobile__paths-title">Choose route</span>
            {CLIENT_PATHS.map((path) => (
              <button
                key={path.id}
                type="button"
                className={clientPath.id === path.id ? 'is-selected' : ''}
                onClick={() => selectPath(path.id, 'nav_mobile')}
              >
                <span>{path.shortLabel}</span>
                <small>{path.eyebrow}</small>
              </button>
            ))}
          </li>
          <li className="nav-mobile__cta">
            <a href={home('#contact')} className="btn btn--primary" onClick={() => setOpen(false)}>
              Request Free Estimate
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
