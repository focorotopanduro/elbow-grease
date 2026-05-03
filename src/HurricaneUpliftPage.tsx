import { Component, lazy, Suspense, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { track } from './lib/analytics';
import { installGlobalErrorHandlers } from './lib/globalErrors';
import { reportWebVitals } from './lib/webVitals';
import { startScrollDepthTracking, trackCta } from './lib/interactions';
import { useQualifiedVisit } from './hooks/useQualifiedVisit';
import PageErrorBoundary from './components/PageErrorBoundary';
import PageImmersiveFAB from './components/PageImmersiveFAB';
import Banner from './sections/Banner';
import BottomMarquee from './sections/BottomMarquee';
import Nav from './sections/Nav';
import Footer from './sections/Footer';
import FloatingCTA from './sections/FloatingCTA';
import MobileLeadCapture from './components/MobileLeadCapture';
import GoldenNuggets from './components/GoldenNuggets';
import AuroraBackdrop from './components/AuroraBackdrop';
import TrustBadge from './components/TrustBadge';
import VerifyToast from './components/VerifyToast';
import { useIsDesktop } from './hooks/useIsDesktop';
import { useReveal } from './hooks/useReveal';
import './HurricaneUpliftPage.css';

/**
 * The full WindUplift simulator is ~265 kB raw / ~62 kB gzipped on its
 * own. Mobile devices NEVER need it (they get MobileLeadCapture instead),
 * so we lazy-load it via dynamic import. Vite/Rollup automatically
 * code-splits the chunk; mobile users save the entire download.
 *
 * The import factory is exported as a named const so we can BOTH:
 *   1. Pass it to React.lazy() for the Suspense-driven render
 *   2. Call it eagerly from a useEffect to PREFETCH the chunk
 *      (functional equivalent of <link rel="modulepreload"> without
 *      needing to know the hashed chunk filename at write-time).
 *
 * The browser caches the module under its URL, so when Suspense
 * triggers the same import() later, it resolves synchronously from
 * the network cache — eliminating the Suspense fallback flash on
 * desktops with reasonable connections.
 *
 * Bonus: MobileLeadCapture stays in the eager bundle (it's tiny ~3 kB
 * and we want it to render INSTANTLY on mobile — no second loading
 * spinner after device detection).
 */
const importWindUpliftVisualizer = () => import('./components/WindUpliftVisualizer');
const WindUpliftVisualizer = lazy(importWindUpliftVisualizer);

/**
 * Inline ErrorBoundary — catches a network failure (server returned
 * 404 / client offline / chunk integrity check failed) when the lazy
 * sim chunk is fetched. Without this, a chunk-load error throws past
 * Suspense and crashes the entire page tree.
 *
 * On error: renders a graceful "couldn't load — call us instead" card.
 * On reset: a single retry attempt via state-bump (the user can also
 * just reload the page, which is the more common recovery path).
 */
interface SimErrorBoundaryProps { children: ReactNode; ctaHref: string; }
interface SimErrorBoundaryState { error: Error | null; }

/** Sentinel key that records an auto-reload attempt — prevents infinite
 *  loops if the chunk legitimately can't load (e.g. CDN is hard-down). */
const RELOAD_SENTINEL_KEY = 'beit:sim-reload-attempted';

class SimErrorBoundary extends Component<SimErrorBoundaryProps, SimErrorBoundaryState> {
  state: SimErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): SimErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Sim chunk load failed:', error, info);

    // STALE-CHUNK AUTO-RECOVERY — if this is a dynamic-import failure
    // (the most common cause: user had the page open across a deploy,
    // and the hashed chunk URL we have is now 404), reload the page
    // ONCE to pick up the fresh asset manifest. Browser cache is
    // bypassed by the page reload + new HTML pointing at fresh hashes.
    //
    // The sentinel in sessionStorage prevents an infinite loop: if a
    // reload was already attempted and we STILL hit this error, fall
    // through to the normal error UI so the user can take recovery
    // action manually. Sentinel is cleared on the next session.
    const isChunkError =
      /loading chunk|failed to fetch dynamically imported module|importing a module/i.test(
        error.message || ''
      );
    if (isChunkError && typeof window !== 'undefined') {
      try {
        const already = window.sessionStorage.getItem(RELOAD_SENTINEL_KEY);
        if (!already) {
          window.sessionStorage.setItem(RELOAD_SENTINEL_KEY, '1');
          track('sim_chunk_load_error', {
            surface: 'desktop',
            reason: error.message || String(error),
            recovery: 'auto_reload',
          });
          window.location.reload();
          return;
        }
      } catch {
        /* sessionStorage unavailable — fall through to manual UI */
      }
    }

    // Pipe to analytics so chunk-load failures show up in the funnel
    // dashboard alongside conversion events. Critical for spotting
    // CDN regressions (sudden spike in this event = bad deploy).
    track('sim_chunk_load_error', {
      surface: 'desktop',
      reason: error.message || String(error),
      recovery: 'manual',
    });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="hup__sim-error" role="alert">
        <p className="eyebrow eyebrow--cream">Simulator unavailable</p>
        <h3>The hurricane simulator couldn't load.</h3>
        <p>
          Probably a network hiccup. Refresh the page to try again — or skip
          straight to the part that matters.
        </p>
        <div className="hup__sim-error-actions">
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              if (typeof window !== 'undefined') window.location.reload();
            }}
            className="btn btn--ghost"
          >
            Reload &amp; retry
          </button>
          <a href={this.props.ctaHref} className="btn btn--primary">
            Book free inspection <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    );
  }
}

function HurricaneUpliftPageInner() {
  useReveal();
  // Device gate: full WindUpliftVisualizer on PC (mouse + big screen
  // + GPU), MobileLeadCapture on phones/tablets. Returns null during
  // first paint to avoid hydration flicker — the loading skeleton
  // covers it. After detection, the right experience renders.
  const isDesktop = useIsDesktop();

  // Ref to the .hup__viz section — used as the fullscreen target
  // by PageImmersiveFAB. Fullscreening this larger container (vs
  // just the SVG inside) gives the user the sim viewport + sidebar
  // HUD at full edge-to-edge, true videogame-console immersion.
  const vizSectionRef = useRef<HTMLElement | null>(null);

  // Global error handlers — catch uncaught synchronous errors +
  // unhandled promise rejections that React's ErrorBoundary cannot
  // see (third-party script failures, awaited fetches without
  // try/catch, etc). Pipes to analytics so production failures show
  // up in the dashboard instead of vanishing into DevTools.
  useEffect(() => { installGlobalErrorHandlers(); }, []);

  // Web Vitals reporter — observes LCP/CLS/INP/FCP/TTFB via native
  // PerformanceObserver and pipes each to analytics on page-hide.
  // Idempotent + zero per-frame cost. Critical for SEO ranking
  // (Google uses these for the Page Experience signal).
  useEffect(() => { reportWebVitals(); }, []);

  // Scroll-depth tracking — fires `scroll_depth` events at
  // 25/50/75/100% milestones (once each). Tells you which ad
  // campaigns bring readers vs bouncers.
  useEffect(() => { startScrollDepthTracking(); }, []);

  // Qualified-visit tracker — fires `sim_qualified_visit` after 30s
  // of cumulative-visible engagement. Surface label routes mobile
  // visits separately from desktop in the funnel dashboard.
  useQualifiedVisit(isDesktop ? 'desktop' : 'mobile');

  // EAGER PREFETCH — kick off the sim chunk download the moment we
  // confirm the user is on desktop. The browser starts downloading
  // ~64 kB gzipped of JS + ~17 kB CSS in the background while React
  // is still rendering the page shell. By the time Suspense triggers
  // the same import() to actually mount the component, the chunk is
  // already in the network cache → no Suspense flash.
  //
  // We deliberately DON'T fire this when isDesktop is null (still
  // detecting) or false (mobile) — that would either waste mobile
  // bandwidth or download too eagerly before we know the device tier.
  useEffect(() => {
    if (isDesktop === true) {
      // Fire-and-forget — we don't await; React.lazy uses the same
      // memoized import() promise so this just warms the cache.
      void importWindUpliftVisualizer();
      // Funnel event — desktop visitor saw the full simulator surface.
      // Mobile fires its own sim_view_mobile from inside MobileLeadCapture.
      track('sim_view_desktop', { surface: 'desktop' });
    }
  }, [isDesktop]);
  return (
    <>
      <a href="#main" className="sr-only">Skip to main content</a>
      {/* JSON-LD STRUCTURED DATA — tells Google + LLMs what this page
          IS. Two graphs: LocalBusiness (Beit Building Contractors) +
          Service (the hurricane simulator + free inspection). Surfaces
          as a rich result in Google for "roofing contractor Orlando"
          searches and lets ChatGPT/Perplexity/etc cite the page when
          people ask about FL hurricane preparation. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'RoofingContractor',
                '@id': 'https://beitbuilding.com/#business',
                name: 'Beit Building Contractors LLC',
                image: 'https://beitbuilding.com/og-image.jpg',
                url: 'https://beitbuilding.com/',
                telephone: '+14075550101',
                priceRange: '$$',
                address: {
                  '@type': 'PostalAddress',
                  streetAddress: '2703 Dobbin Dr',
                  addressLocality: 'Orlando',
                  addressRegion: 'FL',
                  postalCode: '32817',
                  addressCountry: 'US',
                },
                hasCredential: [
                  {
                    '@type': 'EducationalOccupationalCredential',
                    name: 'FL DBPR Certified Roofing Contractor',
                    credentialCategory: 'License',
                    identifier: 'CCC1337413',
                    validIn: { '@type': 'Country', name: 'United States' },
                  },
                  {
                    '@type': 'EducationalOccupationalCredential',
                    name: 'FL DBPR Certified General Contractor',
                    credentialCategory: 'License',
                    identifier: 'CGC1534077',
                    validIn: { '@type': 'Country', name: 'United States' },
                  },
                ],
                areaServed: [
                  { '@type': 'City', name: 'Orlando' },
                  { '@type': 'City', name: 'Winter Park' },
                  { '@type': 'AdministrativeArea', name: 'Orange County, Florida' },
                ],
                makesOffer: {
                  '@type': 'Offer',
                  itemOffered: {
                    '@type': 'Service',
                    name: 'Free roof inspection',
                    description:
                      'On-site inspection of fastener pattern, sheathing condition, and seal-strip bond — what determines whether your roof survives a hurricane.',
                  },
                  price: '0',
                  priceCurrency: 'USD',
                },
              },
              {
                '@type': 'WebApplication',
                '@id': 'https://beitbuilding.com/hurricane-uplift#tool',
                name: 'Hurricane Uplift Simulator',
                applicationCategory: 'EducationalApplication',
                operatingSystem: 'Web',
                browserRequirements: 'Requires JavaScript. Best on desktop browsers.',
                description:
                  'Interactive simulator that shows how a single-story Florida ranch house responds to escalating hurricane wind speeds, modeled on real Florida Building Code §1518 + ASCE 7-22 wind-uplift physics.',
                publisher: { '@id': 'https://beitbuilding.com/#business' },
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
              },
            ],
          }),
        }}
      />
      <Banner />
      <Nav />
      <main id="main" className="hup">
        <header className="hup__hero">
          <AuroraBackdrop />
          <GoldenNuggets count={36} intensity={1.1} />
          <div className="container hup__hero-inner">
            <a
              href="/"
              className="hup__crumb"
              onClick={trackCta('back_home', 'breadcrumb')}
            >
              <span aria-hidden="true">←</span> Back to Beit Building
            </a>
            <p className="eyebrow eyebrow--cream">Free 30-second game &middot; Orlando, FL</p>
            <h1 className="hup__title">
              How long would your roof<br />
              survive a <em>Florida hurricane?</em>
            </h1>
            <p className="hup__lead">
              Drag the slider. Watch your roof get destroyed in real time.
              Hit replay on the storms that hit Florida — Charley, Ian, Andrew.
              Earn achievements. Then book a free inspection on the real one.
            </p>
            <ul className="hup__chips">
              <li><span aria-hidden="true">⚡</span> Watch it live</li>
              <li><span aria-hidden="true">🌀</span> Replay real hurricanes</li>
              <li><span aria-hidden="true">🏆</span> Earn achievements</li>
              <li><span aria-hidden="true">📞</span> Book inspection in 30 sec</li>
            </ul>
          </div>
        </header>

        <section ref={vizSectionRef} className="hup__viz container">
          {isDesktop === null ? (
            // First-paint skeleton — keeps layout stable while detecting.
            // Once useIsDesktop resolves (synchronously in the first
            // useEffect tick), the appropriate experience replaces this.
            <div
              className="hup__detecting"
              role="status"
              aria-label="Loading hurricane simulator"
            />
          ) : isDesktop ? (
            // ErrorBoundary catches chunk-load failures (network glitch,
            // 404, integrity mismatch) so the page degrades to a "call
            // us instead" card rather than crashing. Suspense fallback
            // uses the same skeleton — no visual gap between detection
            // and the chunk arriving (which is usually instant since the
            // useEffect above prefetched it).
            <SimErrorBoundary ctaHref="/#contact">
              <Suspense
                fallback={
                  <div
                    className="hup__detecting"
                    role="status"
                    aria-label="Loading hurricane simulator"
                  />
                }
              >
                <WindUpliftVisualizer ctaHref="/#contact" />
              </Suspense>
            </SimErrorBoundary>
          ) : (
            <MobileLeadCapture
              desktopHref={typeof window !== 'undefined' ? window.location.href : undefined}
              ctaHref="/#contact?utm_source=visualizer&utm_medium=mobile&utm_campaign=wind_uplift_lead"
            />
          )}
        </section>

        {/* Bottom CTA strip — simple, action-driving */}
        <section className="hup__cta-strip">
          <div className="container hup__cta-inner">
            <div>
              <p className="eyebrow eyebrow--cream">30 minutes &middot; No obligation</p>
              <h3>
                Want to see your <em>real</em> roof?
              </h3>
              <p className="hup__cta-sub">
                A Beit Building inspector will tell you what's holding it down,
                what year your shingles are rated for, and whether your sheathing
                still passes today's code. Free.
              </p>
            </div>
            <a
              href="/#contact?utm_source=visualizer&utm_medium=tool&utm_campaign=wind_uplift_strip"
              className="btn btn--primary"
              onClick={trackCta('book_inspection', 'cta_strip')}
            >
              Book free inspection <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        {/* Trust strip — codes shown but not headlined */}
        <section className="hup__trust container">
          <p className="hup__trust-label">
            <span aria-hidden="true">✓</span> Built on real engineering data
          </p>
          <ul className="hup__trust-codes">
            <li>ASCE 7-22 §26.10 + Ch. 30</li>
            <li>FBC 8th Ed. (2023) §708.7 / §1504.1.1 / §1518</li>
            <li>NDS 2018 Tbl 12.2C</li>
            <li>ASTM D7158</li>
            <li>FL OIR My Safe Florida Home 2024</li>
          </ul>
          <details className="hup__disclaimer">
            <summary>The fine print &middot; what this game can &amp; can't do</summary>
            <div className="hup__disclaimer-body">
              <p>
                <strong>This is a teaching tool, not an engineering report.</strong>
                We model a generic one-story Orlando ranch using real building-code
                physics. Your specific home is unique — we can't predict its exact
                behavior without putting eyes on the roof.
              </p>
              <p>
                A free 30-minute inspection from a Beit Building Contractors crew
                will tell you the actual condition of your fasteners, deck, and
                seal-strip bond. The numbers in this tool give you a starting
                vocabulary; the inspection gives you the answer.
              </p>
              <p>
                Real wind-load analysis on a specific structure requires evaluation
                by a Florida-licensed Professional Engineer.
              </p>
            </div>
          </details>
        </section>
      </main>
      <BottomMarquee />
      <Footer />
      <FloatingCTA />
      <TrustBadge />
      <VerifyToast />
      {/* IMMERSIVE FAB — page-level fullscreen + PWA install cluster.
          Fixed top-right, follows scroll. Targets the .hup__viz
          section so fullscreen captures the sim viewport + sidebar
          HUD together (true videogame-console feel). Press F to
          toggle, Esc to exit. */}
      <PageImmersiveFAB fullscreenTargetRef={vizSectionRef} />
      <div className="vignette" aria-hidden="true" />
    </>
  );
}

/**
 * Default export wraps the inner page tree in PageErrorBoundary so
 * any uncaught render error gets a recovery card instead of a white
 * screen. The boundary also pipes `page_error` to analytics for
 * post-deploy monitoring.
 */
export default function HurricaneUpliftPage() {
  return (
    <PageErrorBoundary fallbackHref="/">
      <HurricaneUpliftPageInner />
    </PageErrorBoundary>
  );
}
