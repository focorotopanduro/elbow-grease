import { useEffect, useRef, useState } from 'react';
import { LICENSES, DBPR_URL } from '../components/dbprData';
import { track } from '../lib/analytics';
import { trackCta } from '../lib/interactions';
import './CredentialsWall.css';

/**
 * CredentialsWall — dedicated trust-signal section between Stats and
 * Testimonials. Surfaces the verifiable credentials that visitors
 * actually look for before contacting a contractor:
 *   - DBPR licenses (CCC + CGC) with verifiable links
 *   - State-licensed status
 *   - Bilingual EN/ES capability
 *
 * Placement decision: between Stats and Testimonials, NOT inside the
 * Hero. Hero already has TrustSeal floating; adding the wall there
 * would crowd the primary CTA and hurt mobile rendering. As its own
 * section between numbers and voices (Stats → CredentialsWall →
 * Testimonials), the wall reads as a natural progression of trust
 * signals — quantitative → credentialed → qualitative.
 *
 * Analytics: IntersectionObserver fires `credentials_viewed` ONCE per
 * session when the wall scrolls into view. Helps us measure how often
 * visitors actually see the trust block vs scroll past it.
 */

interface Credential {
  id: string;
  /** Big icon (SVG inline). */
  icon: React.ReactNode;
  /** Short title — 4-6 words. */
  title: string;
  /** 1-line subtitle below the title. */
  subtitle: string;
  /** Optional verifiable link (renders the title as a link). */
  href?: string;
  /** Whether the link opens in a new tab (external = true). */
  external?: boolean;
}

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 4 5v7c0 4.5 3.4 8.7 8 10 4.6-1.3 8-5.5 8-10V5l-8-3z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const SealIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="6" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </svg>
);

const LanguageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 8h10M5 12h7M5 16h5" />
    <path d="M14 14l3 7M14 14l-3 7M11 18h6" />
  </svg>
);

const CREDENTIALS: Credential[] = [
  // Both DBPR licenses — primary trust signal. Each entry's icon is
  // tinted gold via CSS; the text is the verifiable proof.
  {
    id: 'ccc-license',
    icon: <ShieldIcon />,
    title: `Roofing License ${LICENSES[0]?.number ?? 'CCC1337413'}`,
    subtitle: 'Florida DBPR Certified Roofing Contractor — verifiable in real time',
    href: DBPR_URL,
    external: true,
  },
  {
    id: 'cgc-license',
    icon: <ShieldIcon />,
    title: `General License ${LICENSES[1]?.number ?? 'CGC1534077'}`,
    subtitle: 'Florida DBPR Certified General Contractor — covers structural + interior scope',
    href: DBPR_URL,
    external: true,
  },
  {
    id: 'state-licensed',
    icon: <SealIcon />,
    title: 'Florida State Licensed',
    subtitle: 'Both licenses authorise statewide work, not just county-level',
  },
  {
    id: 'bilingual',
    icon: <LanguageIcon />,
    title: 'Bilingual EN / ES',
    subtitle: 'Spanish-speaking project lead available — comunicación clara, en su idioma',
  },
];

export default function CredentialsWall() {
  const sectionRef = useRef<HTMLElement>(null);
  const firedRef = useRef(false);
  const [inView, setInView] = useState(false);

  // IntersectionObserver — fire `credentials_viewed` once when the
  // section first becomes visible. We don't unobserve aggressively
  // because the inView state also drives a class for entrance animation.
  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setInView(true);
          if (!firedRef.current) {
            firedRef.current = true;
            track('cta_click', {
              cta: 'credentials_viewed',
              placement: 'credentials_wall',
            });
          }
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`creds section section--cream ${inView ? 'creds--in-view' : ''}`}
      aria-label="Verifiable credentials"
    >
      <div className="container">
        <header className="creds__header reveal">
          <p className="eyebrow">Verifiable Credentials</p>
          <h2 className="creds__title">
            Two state licenses. <em>Verifiable in two minutes.</em>
          </h2>
          <p className="creds__lead">
            Florida law requires roofing contractors to hold a DBPR-issued
            license. We hold two — both verifiable on the state portal.
            Click either license number to confirm.
          </p>
        </header>

        <ul className="creds__grid">
          {CREDENTIALS.map((c) => (
            <li key={c.id} className="creds__item reveal">
              <span className="creds__icon" aria-hidden="true">{c.icon}</span>
              {c.href ? (
                <a
                  href={c.href}
                  target={c.external ? '_blank' : undefined}
                  rel={c.external ? 'noopener noreferrer' : undefined}
                  className="creds__title-link"
                  data-cta-source={`credentials_${c.id}`}
                  onClick={trackCta(`credentials_${c.id}`, 'credentials_wall')}
                >
                  {c.title} <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <span className="creds__title-text">{c.title}</span>
              )}
              <p className="creds__subtitle">{c.subtitle}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
