import { lazy, Suspense, useEffect } from 'react';
import Banner from './sections/Banner';
import BottomMarquee from './sections/BottomMarquee';
import Nav from './sections/Nav';
import Hero from './sections/Hero';
import SmartPathways from './sections/SmartPathways';
import TrustLedger from './sections/TrustLedger';
import Services from './sections/Services';
import SolutionsGrid from './sections/SolutionsGrid';
import ServiceFeatures from './sections/ServiceFeatures';
import About from './sections/About';
import Contact from './sections/Contact';
import Footer from './sections/Footer';
import FloatingCTA from './sections/FloatingCTA';
import Ornament from './components/Ornament';
import TrustBadge from './components/TrustBadge';
import VerifyToast from './components/VerifyToast';
import MobileStickyCta from './components/MobileStickyCta';
import InstallPrompt from './components/InstallPrompt';
import JsonLd from './components/JsonLd';
import {
  buildLocalBusinessGraph,
  buildServicesGraph,
  buildFaqGraph,
} from './data/schemas';
import {
  SHOW_BEFORE_AFTER,
  SHOW_PROJECT_PORTFOLIO,
  SHOW_STATS,
  SHOW_TESTIMONIALS,
} from './data/liveReadiness';
import { useHashScroll } from './hooks/useHashScroll';
import { useMarbleLighting } from './hooks/useMarbleLighting';
import { useReveal } from './hooks/useReveal';
import { useQualifiedVisit } from './hooks/useQualifiedVisit';
import { track } from './lib/analytics';
import { startScrollDepthTracking } from './lib/interactions';

/**
 * Tier 3 lazy-loading — below-fold sections become their own chunks
 * so the home page's initial JS budget stays small + LCP-relevant
 * content (Hero / Services / SolutionsGrid) ships in the main bundle.
 *
 * Why these specifically:
 *   - BeforeAfterGallery / ProjectPortfolio / Stats / Testimonials:
 *     proof modules; only ship when liveReadiness turns them on.
 *   - CredentialsWall: 6 SVG icons + IntersectionObserver = small but
 *     definitively below-fold
 *   - FAQ: full accordion logic + 12 entries = classic deferred chunk
 *   - BookingWidget: already self-defers via state machine; lazy keeps
 *     even its small mount-time work off the initial bundle
 *
 * NOT lazy-loaded (kept eager):
 *   - Hero / Services / SolutionsGrid / ServiceFeatures: above + just
 *     below the fold; LCP-relevant
 *   - About: brand-narrative critical
 *   - Contact: the conversion vehicle; lazy would risk feeling glitchy
 *     when a user scrolls fast
 */
const BeforeAfterGallery = SHOW_BEFORE_AFTER
  ? lazy(() => import('./sections/BeforeAfterGallery'))
  : null;
const ProjectPortfolio = SHOW_PROJECT_PORTFOLIO
  ? lazy(() => import('./sections/ProjectPortfolio'))
  : null;
const Stats = SHOW_STATS ? lazy(() => import('./sections/Stats')) : null;
const Testimonials = SHOW_TESTIMONIALS
  ? lazy(() => import('./sections/Testimonials'))
  : null;
const CredentialsWall = lazy(() => import('./sections/CredentialsWall'));
const FAQ = lazy(() => import('./sections/FAQ'));
const BookingWidget = lazy(() => import('./components/BookingWidget'));

// Built once at module-load — the schemas are fully data-driven so re-
// rendering produces identical objects. Memoising at module scope avoids
// passing fresh objects to JsonLd on every App re-render, which would
// re-trigger the useEffect dependency check + cause needless DOM writes.
const LOCAL_BUSINESS_SCHEMA = buildLocalBusinessGraph();
const SERVICES_SCHEMA = buildServicesGraph();
const FAQ_SCHEMA = buildFaqGraph(); // null if there are no FAQ entries

/**
 * Suspense fallback for lazy sections — a sized empty div that
 * preserves layout space so the lazy chunk's late mount doesn't
 * trigger CLS (Cumulative Layout Shift). Heights tuned to typical
 * section sizes; intentionally invisible (no spinner) since by the
 * time the user scrolls to it the chunk has typically loaded.
 */
function DeferredFallback({ height }: { height: number }) {
  return <div aria-hidden="true" style={{ minHeight: height }} />;
}

export default function App() {
  useHashScroll();
  useMarbleLighting();
  useReveal();
  // Engagement tracking — fires `lead_form_qualified_visit` event after
  // 30 seconds of cumulative tab-visible + focused time on the home page.
  // Pairs with the existing scroll-depth tracker to give us the visitor-
  // engagement funnel: page_view → qualified_visit → cta_click → form.
  useQualifiedVisit('desktop');

  useEffect(() => {
    track('page_view', { surface: 'desktop', route: '/' });
    startScrollDepthTracking();
  }, []);

  return (
    <>
      {/* JSON-LD schema graph — split across multiple <JsonLd> tags so
          updates to any one schema don't invalidate the others, and so
          Google's parser can attribute parse errors to a specific block.
          The graphs cross-reference via stable @id URIs (defined in
          src/data/business.ts SCHEMA_IDS).
            • local-business — LocalBusiness + RoofingContractor +
              GeneralContractor + Organization + Place + Person + WebSite +
              ImageObjects. Replaces the index.html static fallback.
            • services — Service per offering with hasOfferCatalog +
              capability Offers + audience PeopleAudience.
            • reviews — AggregateRating + per-customer Review entities.
              Suppressed when REVIEWS is empty.
            • faq — FAQPage with Question/Answer pairs mirroring the
              visible FAQ section content. Suppressed when FAQS is empty. */}
      <JsonLd id="local-business" schema={LOCAL_BUSINESS_SCHEMA} />
      <JsonLd id="services" schema={SERVICES_SCHEMA} />
      <JsonLd id="faq" schema={FAQ_SCHEMA} />

      <a href="#main" className="sr-only">Skip to main content</a>
      <Banner />
      <Nav />
      <main id="main">
        <Hero />
        <SmartPathways />
        <TrustLedger />
        <Services />
        <SolutionsGrid />
        <ServiceFeatures />
        <Ornament />
        <About />
        {/* Below-fold sections under Suspense boundaries with sized
            fallbacks (height matches typical section size to avoid
            CLS during chunk hydration). */}
        {BeforeAfterGallery && (
          <Suspense fallback={<DeferredFallback height={520} />}>
            <BeforeAfterGallery />
          </Suspense>
        )}
        {/* Project portfolio — Tier 5. Filterable browsable gallery
            kept behind liveReadiness until real photos and owner-approved
            captions are ready, so placeholder proof never ships. */}
        {ProjectPortfolio && (
          <Suspense fallback={<DeferredFallback height={760} />}>
            <ProjectPortfolio />
          </Suspense>
        )}
        {Stats && (
          <Suspense fallback={<DeferredFallback height={360} />}>
            <Stats />
          </Suspense>
        )}
        <Suspense fallback={<DeferredFallback height={420} />}>
          <CredentialsWall />
        </Suspense>
        {Testimonials && (
          <Suspense fallback={<DeferredFallback height={520} />}>
            <Testimonials />
          </Suspense>
        )}
        <Suspense fallback={<DeferredFallback height={620} />}>
          <FAQ />
        </Suspense>
        {/* BookingWidget renders nothing until CALENDLY_URL is set —
            its lazy chunk is tiny when the section is suppressed. */}
        <Suspense fallback={null}>
          <BookingWidget />
        </Suspense>
        <Contact />
      </main>
      <BottomMarquee />
      <Footer />
      {/* FloatingCTA + MobileStickyCta have complementary breakpoints:
          FloatingCTA shows on >720px (right-bottom corner), MobileStickyCta
          shows on ≤720px (full-width bottom bar). Neither covers the
          other's screen real estate. Both hide when Contact is in viewport. */}
      <FloatingCTA />
      <MobileStickyCta />
      {/* Tier 6 — PWA install affordance. Detects iOS Safari vs
          Chromium-based browsers and shows the appropriate UX
          (single-tap install vs Add-to-Home-Screen instructions).
          Suppressed when offline, when already installed, when
          previously dismissed, or until 5s of engagement. */}
      <InstallPrompt />
      <TrustBadge />
      <VerifyToast />
      <div className="vignette" aria-hidden="true" />
    </>
  );
}
