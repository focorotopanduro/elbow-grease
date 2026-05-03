import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import Banner from '../sections/Banner';
import Nav from '../sections/Nav';
import BottomMarquee from '../sections/BottomMarquee';
import Footer from '../sections/Footer';
import FloatingCTA from '../sections/FloatingCTA';
import TrustLedger from '../sections/TrustLedger';
import FAQ from '../sections/FAQ';
import Contact from '../sections/Contact';
import TrustBadge from '../components/TrustBadge';
import VerifyToast from '../components/VerifyToast';
import BookingWidget from '../components/BookingWidget';
import MobileStickyCta from '../components/MobileStickyCta';
import JsonLd from '../components/JsonLd';
import SEO from '../components/SEO';
import {
  buildLocalBusinessGraph,
  buildServicesGraph,
  buildReviewsGraph,
  buildFaqGraph,
  buildBreadcrumbList,
} from '../data/schemas';
import { buildCityGraph } from '../data/schemas/city';
import { REVIEWS } from '../data/reviews';
import { FAQS } from '../data/faqs';
import {
  SHOW_CITY_PROJECT_GALLERIES,
  SHOW_REVIEW_SCHEMA,
  SHOW_TESTIMONIALS,
} from '../data/liveReadiness';
import { useHashScroll } from '../hooks/useHashScroll';
import { useReveal } from '../hooks/useReveal';
import { useQualifiedVisit } from '../hooks/useQualifiedVisit';
import { track } from '../lib/analytics';
import { startScrollDepthTracking, trackCta } from '../lib/interactions';
import type { CityData } from '../data/cities/types';
import './CityPage.css';

/**
 * CityPage — the per-city service-area landing page template.
 *
 * Renders sections in the conversion-optimized order: hero CTA → service
 * highlights → trust points → project gallery → local testimonials →
 * city-specific FAQ → service area map → final CTA.
 *
 * SHARED COMPONENTS reused from the home page:
 *   - Banner / Nav / Footer / BottomMarquee / FloatingCTA / TrustBadge /
 *     VerifyToast — global chrome stays consistent across all routes
 *   - Testimonials (props-driven) — filtered to city's testimonialIds
 *   - FAQ (props-driven) — filtered to city's faqIds
 *   - Contact — exact same form, identical conversion target
 *
 * SCHEMA mounted on every city page:
 *   - local-business — canonical NAP graph (no per-city duplication)
 *   - services — full Service entities (linked by @id from city graph)
 *   - reviews — filtered AggregateRating + Reviews for this city
 *   - faq — filtered FAQPage for this city
 *   - city — WebPage + BreadcrumbList + City + service-area Place
 *
 * SEO:
 *   - Per-city <title>, description, OG, canonical via <SEO> component
 *   - Per-city schema graph cross-references the canonical business via @id
 */

const LOCAL_BUSINESS_SCHEMA = buildLocalBusinessGraph();
const SERVICES_SCHEMA = buildServicesGraph();
const CityProjects = SHOW_CITY_PROJECT_GALLERIES
  ? lazy(() => import('../sections/CityProjects'))
  : null;
const Testimonials = SHOW_TESTIMONIALS
  ? lazy(() => import('../sections/Testimonials'))
  : null;

export interface CityPageProps {
  city: CityData;
}

export default function CityPage({ city }: CityPageProps) {
  useHashScroll();
  useReveal();
  // City-page engagement tracking — same funnel events as the home page,
  // but tagged with the city slug so we can split conversion rates by
  // landing-page surface.
  useQualifiedVisit('desktop');

  useEffect(() => {
    track('page_view', {
      surface: 'desktop',
      route: `/${city.slug}`,
      city: city.slug,
    });
    startScrollDepthTracking();
  }, [city.slug]);

  // Filter the canonical lists down to this city's referenced ids. Doing
  // it at render time keeps the data layer fully shared across the home
  // page + every city page — the city files contain only id refs.
  const cityReviews = useMemo(
    () =>
      SHOW_TESTIMONIALS || SHOW_REVIEW_SCHEMA
        ? city.testimonialIds
          .map((id) => REVIEWS.find((r) => r.id === id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
        : [],
    [city.testimonialIds],
  );
  const cityFaqs = useMemo(
    () =>
      city.faqIds
        .map((id) => FAQS.find((f) => f.id === id))
        .filter((f): f is NonNullable<typeof f> => Boolean(f)),
    [city.faqIds],
  );

  // Build per-city schema graphs from the filtered data. The reviews +
  // faq schemas use unique @ids that include the city slug to avoid
  // collisions if a crawler indexes both the home page and a city page.
  const reviewsSchema = useMemo(
    () => (SHOW_REVIEW_SCHEMA ? buildReviewsGraph(cityReviews) : null),
    [cityReviews],
  );
  const faqSchema = useMemo(
    () =>
      buildFaqGraph(
        cityFaqs,
        `https://www.beitbuilding.com/${city.slug}#faq`,
      ),
    [cityFaqs, city.slug],
  );
  const citySchema = useMemo(() => buildCityGraph(city), [city]);
  // BreadcrumbList JSON-LD — surfaces a breadcrumb chip in Google's
  // rich results so the SERP listing shows
  // `beitbuilding.com › Home › Orlando Roofing` instead of the raw URL.
  // Mirrors the visible <nav className="city-breadcrumb"> at the top
  // of every city page; if you change the visible labels, change the
  // schema labels too so they stay aligned (Google penalizes mismatch).
  const breadcrumbSchema = useMemo(
    () =>
      buildBreadcrumbList(`/${city.slug}`, [
        { name: 'Home', url: '/' },
        { name: `${city.name} Roofing & Construction`, url: `/${city.slug}` },
      ]),
    [city.slug, city.name],
  );

  return (
    <>
      <SEO
        path={`/${city.slug}`}
        title={`${city.hero.headline} | Beit Building Contractors`}
        description={city.hero.sub}
        ogType="website"
        noindex={city.draft}
      />

      {/* Schema graphs — see CityPage docblock for what each emits. */}
      <JsonLd id="local-business" schema={LOCAL_BUSINESS_SCHEMA} />
      <JsonLd id="services" schema={SERVICES_SCHEMA} />
      {SHOW_REVIEW_SCHEMA && (
        <JsonLd id="reviews" schema={reviewsSchema} />
      )}
      <JsonLd id="faq" schema={faqSchema} />
      <JsonLd id="city" schema={citySchema} />
      <JsonLd id="breadcrumb" schema={breadcrumbSchema} />

      <a href="#main" className="sr-only">Skip to main content</a>
      <Banner />
      <Nav />
      <main id="main">
        <CityHero city={city} />
        <TrustLedger />
        <CityServices city={city} />
        <CityWhyUs city={city} />
        {CityProjects && (
          <Suspense fallback={<div aria-hidden="true" style={{ minHeight: 520 }} />}>
            <CityProjects city={city} />
          </Suspense>
        )}
        {Testimonials && (
          <Suspense fallback={<div aria-hidden="true" style={{ minHeight: 520 }} />}>
            <Testimonials
              reviews={cityReviews}
              eyebrow={`What ${city.name} clients say`}
              titleNode={
                <>
                  {city.name} <em>Testimonials</em>
                </>
              }
            />
          </Suspense>
        )}
        <FAQ
          faqs={cityFaqs}
          eyebrow={`${city.name} FAQ`}
          titleNode={
            <>
              {city.name} <em>questions, answered</em>
            </>
          }
          leadNode={
            <>
              Specific questions from {city.name} homeowners. Don&apos;t see
              yours?{' '}
              <a href="#contact" className="faq__lead-link">
                Ask us directly
              </a>{' '}
              and we&apos;ll follow up directly.
            </>
          }
        />
        {/* BookingWidget — same conditional behavior as the home page.
            Renders only when CALENDLY_URL is set. Sits between the city
            FAQ and the service-area map. */}
        <BookingWidget />
        <CityMap city={city} />
        <Contact />
      </main>
      <BottomMarquee />
      <Footer />
      <FloatingCTA />
      <MobileStickyCta />
      <TrustBadge />
      <VerifyToast />
      <div className="vignette" aria-hidden="true" />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * City-specific section components — kept inside this file so a city page
 * is one self-contained unit of work. Move to /sections/ if shared with
 * other layouts later.
 * ───────────────────────────────────────────────────────────────────────── */

function CityHero({ city }: { city: CityData }) {
  const phoneFirst = city.hero.primaryCtaHref?.startsWith('tel:') ?? false;

  return (
    <section
      id="home"
      className="city-hero section section--dark"
      aria-label={`${city.name} roofing services overview`}
    >
      <div className="container city-hero__inner">
        <nav className="city-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/">Home</a>
            </li>
            <li aria-current="page">
              {city.name} Roofing &amp; Construction
            </li>
          </ol>
        </nav>
        <p className="eyebrow eyebrow--gold">
          {city.county} · {city.state} · Florida DBPR Licensed
        </p>
        <h1 className="city-hero__title">{city.hero.headline}</h1>
        <p className="city-hero__sub">{city.hero.sub}</p>
        <div className="city-hero__cta">
          <a
            href={city.hero.primaryCtaHref ?? '#contact'}
            className="btn btn--primary"
            data-cta-source="city_hero_primary"
            onClick={trackCta(
              city.hero.primaryCtaHref?.startsWith('tel:')
                ? 'call_phone'
                : 'book_quote',
              `city_hero_primary:${city.slug}`,
            )}
          >
            {city.hero.ctaLabel}
          </a>
          {city.hero.secondaryCtaLabel && (
            <a
              href={city.hero.secondaryCtaHref ?? 'tel:+14079426459'}
              className="btn btn--ghost btn--ghost-on-dark"
              data-cta-source="city_hero_secondary"
              onClick={trackCta(
                (city.hero.secondaryCtaHref ?? 'tel:+14079426459').startsWith('tel:')
                  ? 'call_phone'
                  : 'book_quote',
                `city_hero_secondary:${city.slug}`,
              )}
            >
              {city.hero.secondaryCtaLabel}
            </a>
          )}
        </div>
        <p className="city-hero__helptext">
          {phoneFirst
            ? 'Storm issue or active leak? Calling is the fastest path. The form is still available when you need to send details first.'
            : "Not sure which service fits? Start with the closest match. We will help sort the scope when we follow up."}
        </p>
        <ol className="city-next-steps" aria-label="How the estimate process works">
          <li>
            <strong>Tell us what is happening</strong>
            <span>Roof, leak, storm damage, renovation, exterior work, or mixed scope.</span>
          </li>
          <li>
            <strong>We look at the right areas</strong>
            <span>Property access, visible conditions, photos, and documentation needs.</span>
          </li>
          <li>
            <strong>You get the next move</strong>
            <span>Repair, replacement, build path, or what can safely wait.</span>
          </li>
        </ol>
        {city.intro.length > 0 && (
          <div className="city-intro">
            {city.intro.map((p, i) => (
              <p key={i} className="city-intro__para">
                {p}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CityServices({ city }: { city: CityData }) {
  return (
    <section
      id="services"
      className="city-services section"
      aria-label={`Services offered in ${city.name}`}
    >
      <div className="container">
        <header className="city-services__header reveal">
          <p className="eyebrow">Services in {city.name}</p>
          <h2 className="city-services__title">
            What we deliver in <em>{city.name}</em>
          </h2>
        </header>
        <ul className="city-services__grid">
          {city.serviceHighlights.map((s) => (
            <li key={s.serviceId} className="city-service reveal">
              <span className="city-service__tag" aria-hidden="true">
                {s.serviceId}
              </span>
              <h3 className="city-service__headline">{s.headline}</h3>
              <p className="city-service__body">{s.body}</p>
              <a
                href="#contact"
                className="city-service__link"
                data-cta-source={`city_service_${s.serviceId}`}
                onClick={trackCta('book_quote', `city_service:${city.slug}:${s.serviceId}`)}
              >
                Ask about this <span aria-hidden="true">-&gt;</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CityWhyUs({ city }: { city: CityData }) {
  return (
    <section
      id="about"
      className="city-whyus section section--dark"
      aria-label={`Why ${city.name} homeowners choose Beit Building`}
    >
      <div className="container">
        <header className="city-whyus__header reveal">
          <p className="eyebrow">Why {city.name} chooses Beit</p>
          <h2 className="city-whyus__title">
            Local accountability. <em>Two state licenses.</em>
          </h2>
        </header>
        <ul className="city-whyus__grid">
          {city.whyUs.map((w, i) => (
            <li key={w.title} className="city-whyus__pillar reveal">
              <span className="city-whyus__n">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="city-whyus__title-sub">{w.title}</h3>
              <p className="city-whyus__body">{w.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CityMap({ city }: { city: CityData }) {
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${city.name}, ${city.state}`)}`;

  return (
    <section
      className="city-map section"
      aria-label={`${city.name} service area map`}
    >
      <div className="container">
        <header className="city-map__header reveal">
          <p className="eyebrow">{city.name} service area</p>
          <h2 className="city-map__title">
            We work <em>where you live.</em>
          </h2>
          {city.neighborhoods.length > 0 && (
            <p className="city-map__neighborhoods">
              <strong>Active in:</strong> {city.neighborhoods.join(' · ')}
            </p>
          )}
        </header>
        <div className="city-map__embed-wrap reveal">
          {mapLoaded ? (
            <iframe
              src={city.mapEmbed}
              title={`${city.name} service area map`}
              className="city-map__embed"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="city-map__fallback">
              <span className="city-map__pin" aria-hidden="true">FL</span>
              <div>
                <p className="city-map__fallback-title">{city.name}, {city.state}</p>
                <p className="city-map__fallback-copy">
                  Local service-area preview, with neighborhoods listed above.
                </p>
              </div>
              <div className="city-map__actions">
                <button
                  type="button"
                  className="city-map__button"
                  data-cta-source="city_map_load"
                  onClick={(event) => {
                    trackCta('load_map', `city_map:${city.slug}`)(event);
                    setMapLoaded(true);
                  }}
                >
                  Load Map
                </button>
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="city-map__link"
                  data-cta-source="city_map_open"
                  onClick={trackCta('open_map', `city_map:${city.slug}`)}
                >
                  Open Maps
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
