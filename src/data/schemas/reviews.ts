/**
 * Reviews + AggregateRating schema graph builder.
 *
 * Emits two kinds of entities:
 *   1. AggregateRating — referenced from the LocalBusiness via @id so
 *      Google attaches the star-rating snippet to the business in SERPs.
 *   2. Review — one entity per real customer review in src/data/reviews.ts,
 *      each with author Person, reviewBody, reviewRating, and itemReviewed
 *      pointing back to the LocalBusiness via @id.
 *
 * HONESTY:
 *   • Reviews emitted here are 1:1 mirrors of REVIEWS in src/data/reviews.ts,
 *     which itself mirrors the visible Testimonials section on the home page.
 *     Google penalizes "review-only schema" — schema that markup reviews not
 *     visible on the same page.
 *   • datePublished is OMITTED if the underlying review entry doesn't have
 *     one. Schema.org accepts this; the validator emits a warning, not an
 *     error. Owner can add real dates as Phase 12 source attribution lands.
 *   • If REVIEWS becomes empty, buildReviewsGraph() returns an empty @graph
 *     and the LocalBusiness aggregateRating ref is suppressed (see consumer
 *     guard in local-business.ts).
 *
 * Reference:
 *   https://schema.org/Review
 *   https://schema.org/AggregateRating
 *   https://developers.google.com/search/docs/appearance/structured-data/review-snippet
 */

import {
  URL as SITE_URL,
  LEGAL_NAME,
  SCHEMA_IDS,
} from '../business';
import {
  REVIEWS,
  buildAggregateRating,
  type ReviewEntry,
} from '../reviews';

/* ─── ID helpers ──────────────────────────────────────────────────────── */

export const AGGREGATE_RATING_ID = `${SITE_URL}/#aggregate-rating`;
const reviewId = (id: string) => `${SITE_URL}/#review-${id}`;
const authorId = (entry: ReviewEntry) =>
  `${SITE_URL}/#reviewer-${entry.id}`;

/* ─── AggregateRating entity ──────────────────────────────────────────── */

function aggregateRatingEntity(reviews: ReviewEntry[]) {
  const agg = buildAggregateRating(reviews);
  if (agg.reviewCount === 0) return null;
  return {
    '@type': 'AggregateRating',
    '@id': AGGREGATE_RATING_ID,
    itemReviewed: { '@id': SCHEMA_IDS.business },
    ratingValue: agg.ratingValue,
    reviewCount: agg.reviewCount,
    bestRating: agg.bestRating,
    worstRating: agg.worstRating,
  };
}

/* ─── Per-review entity ───────────────────────────────────────────────── */

function reviewEntity(entry: ReviewEntry) {
  const rating = entry.rating ?? 5;
  const author = {
    '@type': 'Person',
    '@id': authorId(entry),
    name: entry.author,
    ...(entry.role ? { jobTitle: entry.role } : {}),
    ...(entry.location
      ? {
          address: {
            '@type': 'PostalAddress',
            addressLocality: entry.location.split(',')[0]?.trim(),
            addressRegion: entry.location.includes(',')
              ? entry.location.split(',')[1]?.trim()
              : undefined,
          },
        }
      : {}),
  };

  // Strip undefined values — Schema.org parsers are strict about null fields.
  const cleanAuthor = JSON.parse(JSON.stringify(author));

  return {
    '@type': 'Review',
    '@id': reviewId(entry.id),
    itemReviewed: { '@id': SCHEMA_IDS.business },
    author: cleanAuthor,
    reviewBody: entry.quote,
    reviewRating: {
      '@type': 'Rating',
      ratingValue: rating,
      bestRating: 5,
      worstRating: 1,
    },
    publisher: { '@id': SCHEMA_IDS.organization },
    inLanguage: 'en-US',
    name: `Review by ${entry.author}`,
    ...(entry.datePublished ? { datePublished: entry.datePublished } : {}),
    ...(entry.source
      ? {
          // If the review was sourced from an external platform, expose
          // that so Google can correlate with the platform's own listing.
          sourceOrganization: {
            '@type': 'Organization',
            name: entry.source,
            ...(entry.sourceUrl ? { url: entry.sourceUrl } : {}),
          },
        }
      : {}),
    about: {
      '@type': 'Thing',
      name: LEGAL_NAME,
    },
  };
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/**
 * Build the Reviews JSON-LD graph. Includes aggregateRating + per-Review
 * entities. Returns null if there are no reviews to mark up (caller can
 * conditionally render the JsonLd component).
 *
 * Pass a custom `reviews` list to scope the graph to a per-page subset
 * (e.g., a city page including only that city's reviews).
 */
export function buildReviewsGraph(reviews: ReviewEntry[] = REVIEWS) {
  if (reviews.length === 0) return null;
  const aggregate = aggregateRatingEntity(reviews);
  if (!aggregate) return null;
  return {
    '@context': 'https://schema.org',
    '@graph': [aggregate, ...reviews.map(reviewEntity)],
  };
}

/**
 * Build the AggregateRating entity in isolation — used by local-business.ts
 * to inline-reference the rating without duplicating the per-Review data.
 */
export function buildAggregateRatingRef(reviews: ReviewEntry[] = REVIEWS) {
  if (reviews.length === 0) return null;
  return aggregateRatingEntity(reviews);
}
