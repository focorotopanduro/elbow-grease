import { useCallback, useEffect, useRef, useState } from 'react';
import { setStoredClientPath, type ClientPathId } from '../data/clientPaths';
import { trackCta } from '../lib/interactions';

/**
 * TrustBadge is now the floating project-routing hub.
 *
 * DBPR verification remains in the Trust Ledger and footer, where visitors
 * can inspect both license numbers without a floating surface repeating the
 * same proof. This pill uses that high-visibility position for conversion:
 * urgent calls, free estimates, and service-fit navigation.
 */

const SEEN_STORAGE_KEY = 'tb:path-seen:v1';
const COMPACT_AT = 400;
const PHONE = import.meta.env.VITE_BUSINESS_PHONE || '+14079426459';

const ROUTES = [
  {
    title: 'Active leak or storm issue',
    body: 'Fastest path when water is moving or the roof needs urgent eyes.',
    cta: 'Call now',
    href: `tel:${PHONE}`,
    event: 'call_phone',
    path: 'storm',
  },
  {
    title: 'Roof or build estimate',
    body: 'Send the property details and what you are trying to solve.',
    cta: 'Request estimate',
    href: '#contact',
    event: 'book_quote',
    path: 'roof',
  },
  {
    title: 'Not sure what fits',
    body: 'Compare roofing, construction, decks, fencing, paint, and siding.',
    cta: 'See services',
    href: '#services',
    event: 'view_services',
    path: 'manager',
  },
] satisfies ReadonlyArray<{
  title: string;
  body: string;
  cta: string;
  href: string;
  event: string;
  path: ClientPathId;
}>;

const HubIcon = () => (
  <svg className="tb__shield" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"
      fill="currentColor"
      opacity="0.16"
    />
    <path
      d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M8 12h8M12 8v8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export default function TrustBadge() {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [pulsing, setPulsing] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return !window.localStorage.getItem(SEEN_STORAGE_KEY); }
    catch { return true; }
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const pulseTimer = useRef<number | null>(null);
  const visibleSuppressionZones = useRef<Set<Element>>(new Set());

  useEffect(() => {
    if (!pulsing) return;
    pulseTimer.current = window.setTimeout(() => {
      setPulsing(false);
      try { window.localStorage.setItem(SEEN_STORAGE_KEY, '1'); }
      catch { /* ignore */ }
    }, 6000);
    return () => {
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    };
  }, [pulsing]);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > COMPACT_AT);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Step aside near proof, contact, and footer surfaces so fixed UI does not
  // compete with the user's active task.
  useEffect(() => {
    const zones = Array.from(
      document.querySelectorAll<HTMLElement>('[data-trust-verify-zone], #contact, footer'),
    );
    if (zones.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.12) {
            visibleSuppressionZones.current.add(entry.target);
          } else {
            visibleSuppressionZones.current.delete(entry.target);
          }
        });

        const shouldSuppress = visibleSuppressionZones.current.size > 0;
        setSuppressed(shouldSuppress);
        if (shouldSuppress) {
          setOpen(false);
          setPulsing(false);
        }
      },
      {
        threshold: [0, 0.12, 0.28, 0.5],
        rootMargin: '0px 0px -12% 0px',
      },
    );

    const suppressionZones = visibleSuppressionZones.current;
    zones.forEach((zone) => observer.observe(zone));
    return () => {
      suppressionZones.clear();
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    };
  }, []);

  const onTogglePill = useCallback(() => {
    setOpen((o) => !o);
    setPulsing(false);
    try { window.localStorage.setItem(SEEN_STORAGE_KEY, '1'); }
    catch { /* ignore */ }
  }, []);

  const closeAndTrack = useCallback(
    (eventName: string, placement: string, path: ClientPathId) =>
      (event?: { currentTarget?: HTMLElement | EventTarget | null }) => {
        setStoredClientPath(path, `project_path:${placement}`);
        trackCta(eventName, placement)(event);
        setOpen(false);
      },
    [],
  );

  return (
    <div
      ref={wrapRef}
      className={[
        'tb',
        open ? 'is-open' : '',
        suppressed ? 'is-suppressed' : '',
        pulsing ? 'is-pulsing' : '',
        compact && !open && !suppressed ? 'is-compact' : '',
      ].filter(Boolean).join(' ')}
      aria-hidden={suppressed ? true : undefined}
    >
      <button
        type="button"
        className="tb__pill"
        onClick={onTogglePill}
        tabIndex={suppressed ? -1 : undefined}
        aria-expanded={open}
        aria-label="Open project routing options"
      >
        <HubIcon />
        <span className="tb__pill-text">
          <strong>Project Path</strong>
          <span className="tb__pill-sub">Call / Estimate / Services</span>
        </span>
        <span className="tb__chevron" aria-hidden="true">
          {open ? '^' : 'v'}
        </span>

        <span className="tb__hover-preview" aria-hidden="true">
          <span>Choose the fastest next step</span>
          <strong>Urgent call</strong>
          <strong>Free estimate</strong>
          <strong>Service fit</strong>
        </span>
      </button>

      {open && (
        <div className="tb__card" role="dialog" aria-label="Project routing options">
          <header className="tb__head">
            <div className="tb__seal" aria-hidden="true">
              <svg viewBox="0 0 56 56" width="48" height="48">
                <circle cx="28" cy="28" r="26" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M28 10 42 18v15L28 46 14 33V18L28 10Z"
                  fill="rgba(107, 29, 29, 0.18)"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path d="M20 27h16M28 19v16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="28" cy="28" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
              </svg>
            </div>
            <div className="tb__head-text">
              <p className="tb__head-eye">Quick Route</p>
              <h3 className="tb__head-title">What happens next?</h3>
              <p className="tb__head-sub">
                Pick the closest path. The form, phone call, and service page
                all route into the same estimate follow-up.
              </p>
            </div>
            <button
              type="button"
              className="tb__close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >x</button>
          </header>

          <div className="tb__licenses tb__routes">
            {ROUTES.map((route, index) => (
              <a
                key={route.title}
                href={route.href}
                className="tb__license tb__route"
                data-cta-source={`project_path_${route.event}`}
                onClick={closeAndTrack(route.event, `project_path:${route.href}`, route.path)}
              >
                <div className="tb__license-row">
                  <span className="tb__route-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="tb__license-action">{route.cta} -&gt;</span>
                </div>
                <div className="tb__license-type">{route.title}</div>
                <div className="tb__license-scope">{route.body}</div>
              </a>
            ))}
          </div>

          <footer className="tb__foot">
            <p className="tb__hint">
              <span className="tb__hint-key">Fit</span>
              Useful details: roof age, leak location, photos if available,
              and whether the issue is active or preventive.
            </p>
            <p className="tb__verified-line">
              <span className="tb__active-dot" aria-hidden="true" />
              Free estimate windows. EN/ES follow-up available.
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}
