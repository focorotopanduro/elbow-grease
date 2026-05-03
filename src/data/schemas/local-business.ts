/**
 * LocalBusiness + RoofingContractor schema graph builder.
 *
 * Architecture: emits a `@graph` array containing multiple linked entities
 * (Organization, LocalBusiness/RoofingContractor, Place, WebSite, ImageObject,
 * Person/founder) cross-referenced by stable `@id` URIs. This is the
 * gold-standard pattern for local SEO schema — search engines treat the
 * graph as one logical record, and downstream pages (city pages in Phase 6+,
 * blog posts in Phase 9+) can reference these entities by `@id` without
 * redefining them.
 *
 * Reference:
 *   https://schema.org/LocalBusiness
 *   https://schema.org/RoofingContractor
 *   https://developers.google.com/search/docs/appearance/structured-data/local-business
 *
 * Validate at:
 *   https://search.google.com/test/rich-results
 *   https://validator.schema.org/
 */

import {
  LEGAL_NAME,
  BRAND_NAME,
  ALTERNATE_NAMES,
  SLOGAN,
  DESCRIPTION,
  URL as SITE_URL,
  LOGO_URL,
  IMAGE_URL,
  FOUNDER_NAME,
  PHONE_E164,
  EMAIL,
  ADDRESS,
  GEO,
  AREA_SERVED,
  OPENING_HOURS,
  PRICE_RANGE,
  PAYMENT_ACCEPTED,
  CURRENCIES_ACCEPTED,
  KNOWS_LANGUAGE,
  SAME_AS,
  SERVICES,
  KEYWORDS,
  LICENSES,
  SCHEMA_IDS,
} from '../business';
import { AGGREGATE_RATING_ID } from './reviews';
import { LIVE_READINESS } from '../liveReadiness';

/* ─── Day-name helpers ────────────────────────────────────────────────── */

/**
 * Schema.org day enum URIs. Using full URIs (not bare names) lets validators
 * match without ambiguity — required by some strict parsers.
 */
const DAY_URI: Record<string, string> = {
  Monday: 'https://schema.org/Monday',
  Tuesday: 'https://schema.org/Tuesday',
  Wednesday: 'https://schema.org/Wednesday',
  Thursday: 'https://schema.org/Thursday',
  Friday: 'https://schema.org/Friday',
  Saturday: 'https://schema.org/Saturday',
  Sunday: 'https://schema.org/Sunday',
};

function openingHoursSpec() {
  return OPENING_HOURS.map((block) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: block.days.map((d) => DAY_URI[d]),
    opens: block.opens,
    closes: block.closes,
  }));
}

/* ─── Address + Geo ───────────────────────────────────────────────────── */

function postalAddress() {
  return {
    '@type': 'PostalAddress',
    streetAddress: ADDRESS.streetAddress,
    addressLocality: ADDRESS.addressLocality,
    addressRegion: ADDRESS.addressRegion,
    postalCode: ADDRESS.postalCode,
    addressCountry: ADDRESS.addressCountry,
  };
}

function geoCoordinates() {
  return {
    '@type': 'GeoCoordinates',
    latitude: GEO.latitude,
    longitude: GEO.longitude,
  };
}

/* ─── Area served ─────────────────────────────────────────────────────── */

function areaServed() {
  return AREA_SERVED.map((a) => ({
    '@type': a.type,
    name: a.name,
    ...(a.type === 'AdministrativeArea'
      ? { containedInPlace: { '@type': 'State', name: 'Florida' } }
      : {}),
  }));
}

/* ─── Identifiers (licenses) ──────────────────────────────────────────── */

/**
 * Each DBPR license becomes a PropertyValue with `propertyID` set to the
 * issuing authority. Google indexes these for "licensed roofer near me"
 * style intents and surfaces them in the Knowledge Panel.
 */
function identifiers() {
  return LICENSES.map((lic) => ({
    '@type': 'PropertyValue',
    propertyID: 'Florida DBPR License',
    name: lic.type,
    value: lic.number,
    validThrough: toIsoDate(lic.expires),
  }));
}

/** "08/31/2026" → "2026-08-31" for ISO compatibility. */
function toIsoDate(usDate: string): string {
  const [mm, dd, yyyy] = usDate.split('/');
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/* ─── sameAs filter (skip TODO empties) ───────────────────────────────── */

function sameAsUrls(): string[] {
  return SAME_AS.map((s) => s.url).filter(Boolean);
}

/* ─── Offer catalog ───────────────────────────────────────────────────── */

/**
 * Service offerings as an OfferCatalog. Phase 4 expands each Offer with a
 * full Service entity (with hasOfferCatalog → priceRange, areaServed, etc.).
 * For Phase 3 we keep these as light Offer references that link to the
 * SolutionsGrid sections via URL fragment.
 */
function offerCatalog() {
  return {
    '@type': 'OfferCatalog',
    name: 'Construction & Roofing Services',
    itemListElement: SERVICES.map((s, i) => ({
      '@type': 'Offer',
      position: i + 1,
      itemOffered: {
        '@type': 'Service',
        '@id': `${SITE_URL}/#service-${s.id}`,
        name: s.name,
        description: s.description,
        serviceType: s.serviceType,
        provider: { '@id': SCHEMA_IDS.business },
        areaServed: { '@id': SCHEMA_IDS.place },
      },
      url: `${SITE_URL}/#${s.id === 'roofing' ? 'services' : s.id}`,
    })),
  };
}

/* ─── Entity builders ─────────────────────────────────────────────────── */

function organizationEntity() {
  return {
    '@type': 'Organization',
    '@id': SCHEMA_IDS.organization,
    name: LEGAL_NAME,
    legalName: LEGAL_NAME,
    alternateName: ALTERNATE_NAMES,
    url: `${SITE_URL}/`,
    logo: { '@id': SCHEMA_IDS.logo },
    image: { '@id': SCHEMA_IDS.image },
    sameAs: sameAsUrls(),
    founder: { '@id': SCHEMA_IDS.founder },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        telephone: PHONE_E164,
        email: EMAIL,
        availableLanguage: KNOWS_LANGUAGE,
        areaServed: 'US-FL',
      },
    ],
  };
}

function placeEntity() {
  return {
    '@type': 'Place',
    '@id': SCHEMA_IDS.place,
    name: BRAND_NAME,
    address: postalAddress(),
    geo: geoCoordinates(),
    hasMap: `https://maps.google.com/?q=${encodeURIComponent(
      `${ADDRESS.streetAddress} ${ADDRESS.addressLocality} ${ADDRESS.addressRegion} ${ADDRESS.postalCode}`,
    )}`,
  };
}

function localBusinessEntity() {
  return {
    // Multi-type: LocalBusiness covers the generic local-business signals,
    // RoofingContractor narrows to the niche for "roofer near me" intent,
    // GeneralContractor (3rd type) captures the non-roof construction work.
    '@type': ['LocalBusiness', 'RoofingContractor', 'GeneralContractor'],
    '@id': SCHEMA_IDS.business,
    name: LEGAL_NAME,
    alternateName: ALTERNATE_NAMES,
    legalName: LEGAL_NAME,
    description: DESCRIPTION,
    slogan: SLOGAN,
    url: `${SITE_URL}/`,
    telephone: PHONE_E164,
    email: EMAIL,
    image: { '@id': SCHEMA_IDS.image },
    logo: { '@id': SCHEMA_IDS.logo },
    address: postalAddress(),
    geo: geoCoordinates(),
    hasMap: `https://maps.google.com/?q=${encodeURIComponent(
      `${ADDRESS.streetAddress} ${ADDRESS.addressLocality} ${ADDRESS.addressRegion} ${ADDRESS.postalCode}`,
    )}`,
    areaServed: areaServed(),
    openingHoursSpecification: openingHoursSpec(),
    priceRange: PRICE_RANGE,
    paymentAccepted: PAYMENT_ACCEPTED,
    currenciesAccepted: CURRENCIES_ACCEPTED,
    knowsLanguage: KNOWS_LANGUAGE,
    keywords: KEYWORDS.join(', '),
    founder: { '@id': SCHEMA_IDS.founder },
    sameAs: sameAsUrls(),
    identifier: identifiers(),
    hasOfferCatalog: offerCatalog(),
    parentOrganization: { '@id': SCHEMA_IDS.organization },
    location: { '@id': SCHEMA_IDS.place },
    // aggregateRating stays off until externally sourced review metadata
    // is ready and the visible Testimonials section is live.
    ...(LIVE_READINESS.showReviewSchema
      ? { aggregateRating: { '@id': AGGREGATE_RATING_ID } }
      : {}),
  };
}

function founderEntity() {
  return {
    '@type': 'Person',
    '@id': SCHEMA_IDS.founder,
    name: FOUNDER_NAME,
    jobTitle: 'Owner & Qualifier',
    worksFor: { '@id': SCHEMA_IDS.organization },
  };
}

function websiteEntity() {
  return {
    '@type': 'WebSite',
    '@id': SCHEMA_IDS.website,
    url: `${SITE_URL}/`,
    name: BRAND_NAME,
    description: DESCRIPTION,
    publisher: { '@id': SCHEMA_IDS.organization },
    inLanguage: 'en-US',
    potentialAction: [
      {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/?s={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    ],
  };
}

function logoImageEntity() {
  return {
    '@type': 'ImageObject',
    '@id': SCHEMA_IDS.logo,
    url: LOGO_URL,
    contentUrl: LOGO_URL,
    width: 512,
    height: 512,
    caption: `${BRAND_NAME} logo`,
    inLanguage: 'en-US',
  };
}

function primaryImageEntity() {
  return {
    '@type': 'ImageObject',
    '@id': SCHEMA_IDS.image,
    url: IMAGE_URL,
    contentUrl: IMAGE_URL,
    width: 1200,
    height: 630,
    caption: `${BRAND_NAME} — roofing and construction in Orlando`,
    inLanguage: 'en-US',
  };
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/**
 * Build the LocalBusiness JSON-LD graph. Returns a plain object suitable
 * for JSON.stringify into a `<script type="application/ld+json">` tag.
 *
 * Includes 7 cross-linked entities:
 *   - Organization
 *   - LocalBusiness + RoofingContractor + GeneralContractor (multi-type)
 *   - Place
 *   - Person (founder)
 *   - WebSite
 *   - ImageObject (logo)
 *   - ImageObject (primary image / og)
 */
export function buildLocalBusinessGraph() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organizationEntity(),
      localBusinessEntity(),
      placeEntity(),
      founderEntity(),
      websiteEntity(),
      logoImageEntity(),
      primaryImageEntity(),
    ],
  };
}

/**
 * Static-snapshot variant — used by `scripts/build-static-schema.mjs` (see
 * Phase 3 wire-up) to dump a JSON file we can paste back into index.html
 * as the no-JS crawler fallback. Identical to `buildLocalBusinessGraph()`
 * but exported separately so the runtime + build-time uses are explicit.
 */
export const buildStaticLocalBusinessGraph = buildLocalBusinessGraph;
