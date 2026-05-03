/**
 * Service schema graph builder.
 *
 * Emits one Service entity per service in BUSINESS.SERVICES, plus a parent
 * ItemList that orders them. Each Service:
 *   - cross-references the LocalBusiness as `provider` via @id (no
 *     duplicate NAP — the entity graph stays DRY)
 *   - cross-references the Place as `areaServed` (plus city array)
 *   - exposes capabilities as a hasOfferCatalog → OfferCatalog → Offer chain
 *   - declares a free-estimate offer with priceSpecification + eligibleRegion
 *   - targets PeopleAudience (residential) and/or BusinessAudience (commercial)
 *
 * Reference:
 *   https://schema.org/Service
 *   https://developers.google.com/search/docs/appearance/structured-data/local-business
 *
 * The Service @id values match the placeholder offers emitted by
 * local-business.ts so a downstream consumer (or Google's parser) can
 * resolve the link without re-defining the service.
 */

import {
  URL as SITE_URL,
  SERVICES,
  AREA_SERVED,
  KNOWS_LANGUAGE,
  CURRENCIES_ACCEPTED,
  SCHEMA_IDS,
  type ServiceEntry,
} from '../business';

/* ─── Audience helpers ────────────────────────────────────────────────── */

interface AudienceSpec {
  audienceType: string;
  /** Audience-specific name shown in some Google surfaces. */
  name?: string;
  /** Optional geographic restriction. */
  geographicArea?: string;
}

/**
 * Beit serves both homeowners and commercial property owners. Each service
 * gets the audience(s) it actually serves — Roofing/General/Painting all
 * apply to both; Deck/Fence is residential-leaning.
 */
function audienceFor(service: ServiceEntry): AudienceSpec[] {
  switch (service.id) {
    case 'roofing':
      return [
        { audienceType: 'Homeowner', name: 'Residential property owners' },
        { audienceType: 'Business', name: 'Commercial property owners' },
        { audienceType: 'PropertyManager', name: 'Property managers' },
      ];
    case 'general':
      return [
        { audienceType: 'Homeowner', name: 'Residential property owners' },
        { audienceType: 'Business', name: 'Commercial developers' },
      ];
    case 'deck':
      return [
        { audienceType: 'Homeowner', name: 'Residential property owners' },
      ];
    case 'paint':
      return [
        { audienceType: 'Homeowner', name: 'Residential property owners' },
        { audienceType: 'Business', name: 'Commercial property owners' },
      ];
    default:
      return [{ audienceType: 'PeopleAudience', name: 'General audience' }];
  }
}

/* ─── Capability → Offer ──────────────────────────────────────────────── */

/**
 * Each service capability becomes an Offer in a hasOfferCatalog. We mark
 * them as "Free estimate" with priceSpecification — quoting accurately
 * over the web requires inspection, which Beit offers free of charge.
 */
function capabilityOffers(service: ServiceEntry, anchorUrl: string) {
  return service.capabilities.map((cap, i) => ({
    '@type': 'Offer',
    position: i + 1,
    name: cap,
    description: `${cap} — ${service.serviceType.toLowerCase()} service performed by Beit Building Contractors.`,
    url: anchorUrl,
    priceSpecification: {
      '@type': 'PriceSpecification',
      description: 'Free estimate · contact for project pricing',
      priceCurrency: CURRENCIES_ACCEPTED,
    },
    availability: 'https://schema.org/InStock',
    seller: { '@id': SCHEMA_IDS.business },
    eligibleRegion: AREA_SERVED.map((a) => ({
      '@type': a.type,
      name: a.name,
    })),
    eligibleCustomerType: audienceFor(service).map((a) => a.audienceType),
  }));
}

/* ─── Per-service entity ──────────────────────────────────────────────── */

function serviceEntity(service: ServiceEntry, position: number) {
  // Anchor URL — for the home page we link to the SolutionsGrid section
  // anchor. Phase 6+ will extend this to per-service deep pages.
  const anchorFrag = service.id === 'roofing' ? 'services' : service.id;
  const anchorUrl = `${SITE_URL}/#${anchorFrag}`;
  const audiences = audienceFor(service);

  return {
    '@type': 'Service',
    '@id': `${SITE_URL}/#service-${service.id}`,
    name: service.name,
    serviceType: service.serviceType,
    description: service.description,
    url: anchorUrl,
    position,
    provider: { '@id': SCHEMA_IDS.business },
    brand: { '@id': SCHEMA_IDS.organization },
    image: { '@id': SCHEMA_IDS.image },
    areaServed: [
      { '@id': SCHEMA_IDS.place },
      ...AREA_SERVED.map((a) => ({
        '@type': a.type,
        name: a.name,
      })),
    ],
    audience: audiences.map((a) => ({
      '@type': 'PeopleAudience',
      audienceType: a.audienceType,
      name: a.name,
      ...(a.geographicArea
        ? { geographicArea: { '@type': 'Place', name: a.geographicArea } }
        : {}),
    })),
    availableLanguage: KNOWS_LANGUAGE,
    category: service.serviceType,
    serviceOutput: service.capabilities.join(', '),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${service.name} — capabilities`,
      itemListElement: capabilityOffers(service, anchorUrl),
    },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: CURRENCIES_ACCEPTED,
      availability: 'https://schema.org/InStock',
      offerCount: service.capabilities.length,
      eligibleRegion: AREA_SERVED.map((a) => ({
        '@type': a.type,
        name: a.name,
      })),
      seller: { '@id': SCHEMA_IDS.business },
      priceSpecification: {
        '@type': 'PriceSpecification',
        description: 'Free estimate · per-project pricing',
        priceCurrency: CURRENCIES_ACCEPTED,
      },
    },
    termsOfService: `${SITE_URL}/terms.html`,
  };
}

/* ─── Top-level ItemList wrapper ──────────────────────────────────────── */

function servicesItemList() {
  return {
    '@type': 'ItemList',
    '@id': `${SITE_URL}/#services-list`,
    name: 'Beit Building Contractors — services offered',
    numberOfItems: SERVICES.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: SERVICES.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/#service-${s.id}`,
      name: s.name,
      item: { '@id': `${SITE_URL}/#service-${s.id}` },
    })),
  };
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/**
 * Build the Services JSON-LD graph. Returns an object with @context +
 * @graph containing one Service entity per service plus the ItemList
 * wrapper. Designed to be passed straight to <JsonLd schema={...} />.
 */
export function buildServicesGraph() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      servicesItemList(),
      ...SERVICES.map((s, i) => serviceEntity(s, i + 1)),
    ],
  };
}
