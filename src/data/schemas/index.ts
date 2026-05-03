/**
 * Schema graph generators — barrel exports.
 *
 * Each module here produces a JSON-LD-shaped object suitable for direct
 * stringification into a `<script type="application/ld+json">` tag via
 * the <JsonLd /> component.
 *
 * Phase status:
 *   ✓ Phase 3 — local-business.ts (LocalBusiness + RoofingContractor + …)
 *   ✓ Phase 4 — services.ts (Service entities with offers/areaServed)
 *   ✓ Phase 4 — reviews.ts (aggregateRating + Review)
 *   ✓ Phase 5 — faq.ts (FAQPage + Question/Answer)
 *   • Phase 6+ — breadcrumbs.ts (BreadcrumbList for city + blog pages)
 *   • Phase 9+ — article.ts (BlogPosting / Article for blog posts)
 */

export {
  buildLocalBusinessGraph,
  buildStaticLocalBusinessGraph,
} from './local-business';

export { buildServicesGraph } from './services';

export {
  buildReviewsGraph,
  buildAggregateRatingRef,
  AGGREGATE_RATING_ID,
} from './reviews';

export { buildFaqGraph, FAQ_PAGE_ID } from './faq';

export {
  buildBreadcrumbList,
  breadcrumbId,
  type BreadcrumbItem,
} from './breadcrumbs';

export {
  buildCityGraph,
  cityCanonicalUrl,
  cityPageId,
  cityPlaceId,
  cityServiceAreaId,
  cityPageUrl,
  CITY_DEFAULT_LANGUAGE,
} from './city';
