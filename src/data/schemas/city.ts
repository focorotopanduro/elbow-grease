/**
 * City page schema graph builder.
 *
 * Emits a per-city @graph with the entities Google needs to understand a
 * service-area landing page:
 *   - WebPage (with @id, references the canonical breadcrumb + business)
 *   - BreadcrumbList (Home > [City])
 *   - City (@type: City) with geo + containedInPlace chain
 *   - Place — the city service area as a Place node referenced by Service
 *
 * The LocalBusiness, Organization, ImageObjects, Service, Review, FAQ
 * schemas are NOT redefined here — they're already mounted on the page
 * by the same JsonLd component infrastructure used by the home page.
 * Cross-page entities are linked exclusively via stable @id URIs.
 *
 * Reference:
 *   https://schema.org/WebPage
 *   https://schema.org/City
 *   https://developers.google.com/search/docs/appearance/structured-data/local-business
 */

import {
  URL as SITE_URL,
  SCHEMA_IDS,
  BRAND_NAME,
  IMAGE_URL,
  KNOWS_LANGUAGE,
} from '../business';
import { buildBreadcrumbList } from './breadcrumbs';
import type { CityData } from '../cities/types';

/* ─── Stable @id helpers ──────────────────────────────────────────────── */

const cityPageUrl = (city: CityData) => `${SITE_URL}/${city.slug}`;
const cityPageId = (city: CityData) => `${cityPageUrl(city)}#webpage`;
const cityPlaceId = (city: CityData) => `${cityPageUrl(city)}#city`;
const cityServiceAreaId = (city: CityData) =>
  `${cityPageUrl(city)}#service-area`;

/* ─── Entity builders ─────────────────────────────────────────────────── */

function webPageEntity(city: CityData) {
  return {
    '@type': 'WebPage',
    '@id': cityPageId(city),
    url: cityPageUrl(city),
    name: city.hero.headline,
    description: city.hero.sub,
    inLanguage: 'en-US',
    isPartOf: { '@id': SCHEMA_IDS.website },
    about: { '@id': SCHEMA_IDS.business },
    breadcrumb: { '@id': `${cityPageUrl(city)}#breadcrumb` },
    primaryImageOfPage: { '@id': SCHEMA_IDS.image },
    image: IMAGE_URL,
    publisher: { '@id': SCHEMA_IDS.organization },
    // Hint Google that the page is the canonical entry for this query
    // intent. Combined with the WebPage's `about` ref, this strengthens
    // the city → business association.
    significantLink: [
      `${SITE_URL}/`,
      `${cityPageUrl(city)}#contact`,
    ],
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.city-hero__title', '.city-hero__sub', '.city-intro p'],
    },
  };
}

function cityEntity(city: CityData) {
  return {
    '@type': 'City',
    '@id': cityPlaceId(city),
    name: city.name,
    address: {
      '@type': 'PostalAddress',
      addressLocality: city.name,
      addressRegion: city.state,
      addressCountry: 'US',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: city.geo.lat,
      longitude: city.geo.lng,
    },
    containedInPlace: {
      '@type': 'AdministrativeArea',
      name: city.county,
      containedInPlace: {
        '@type': 'State',
        name: 'Florida',
      },
    },
    ...(city.neighborhoods.length
      ? {
          // Neighborhood schema is informal in Schema.org but Google
          // accepts an array of Place children — useful for "[city]
          // [neighborhood] roofer" long-tail queries.
          containsPlace: city.neighborhoods.map((n) => ({
            '@type': 'Place',
            name: `${n}, ${city.name}, ${city.state}`,
          })),
        }
      : {}),
  };
}

function serviceAreaPlaceEntity(city: CityData) {
  return {
    '@type': 'Place',
    '@id': cityServiceAreaId(city),
    name: `${BRAND_NAME} service area — ${city.name}`,
    containedInPlace: { '@id': cityPlaceId(city) },
    ...(city.serviceAreaPolygon
      ? {
          geo: {
            '@type': 'GeoShape',
            polygon: city.serviceAreaPolygon,
          },
        }
      : {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: city.geo.lat,
            longitude: city.geo.lng,
          },
        }),
  };
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/**
 * Build the city-page JSON-LD graph. Returns an object that can be passed
 * directly to <JsonLd schema={...} />.
 */
export function buildCityGraph(city: CityData) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      webPageEntity(city),
      buildBreadcrumbList(`/${city.slug}`, [
        { name: 'Home', url: '/' },
        { name: `${city.name} Roofing & Construction`, url: `/${city.slug}` },
      ]),
      cityEntity(city),
      serviceAreaPlaceEntity(city),
    ],
  };
}

/**
 * Stable canonical URL for a city — used by SEO component on city page.
 */
export function cityCanonicalUrl(city: CityData): string {
  return cityPageUrl(city);
}

export {
  cityPageId,
  cityPlaceId,
  cityServiceAreaId,
  cityPageUrl,
};

/**
 * Helper exposing the inLanguage value the city schema uses, in case a
 * future i18n pass localizes per-city pages (Spanish-language Orlando
 * page would set this to 'es').
 */
export const CITY_DEFAULT_LANGUAGE = KNOWS_LANGUAGE[0];
