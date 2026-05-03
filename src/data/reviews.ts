/**
 * Customer reviews — single source of truth.
 *
 * Used by:
 *   - src/sections/Testimonials.tsx (the visible UI block)
 *   - src/data/schemas/reviews.ts (Review + AggregateRating JSON-LD)
 *
 * HONESTY CONSTRAINTS:
 *   • Review TEXT below mirrors what's already public on the website's
 *     Testimonials block — these are real customer quotes the owner has
 *     used in marketing.
 *   • RATING defaults to 5 because the existing Testimonials UI displays
 *     5 stars on every quote. If the owner wants per-quote variance later,
 *     the Review type accepts an optional explicit rating.
 *   • DATE-PUBLISHED + SOURCE-PLATFORM are deliberately optional and
 *     marked TODO. Schema.org Review accepts entries without these (they
 *     are "recommended" not "required"); Google's Rich Results validator
 *     emits warnings, not errors, when they're missing. The owner should
 *     populate them when source attribution is available (e.g., once
 *     these reviews are pulled from the verified Google Business Profile
 *     in Phase 12).
 *   • NEVER fabricate review counts, dates, or quotes. Adding fake reviews
 *     is grounds for a Google manual penalty + delisting.
 */

export type ReviewSource =
  | 'Google'
  | 'Facebook'
  | 'BBB'
  | 'HomeAdvisor'
  | 'Angi'
  | 'Yelp'
  | 'Direct';

export interface ReviewEntry {
  /** Stable id for React keys + schema @id fragments. */
  id: string;
  /** Reviewer's full name (or "First L." abbreviation if privacy-redacted). */
  author: string;
  /** Reviewer role/relationship — "Homeowner", "Property Investor", etc. */
  role?: string;
  /** Locality the review is anchored to — used in schema and visible UI. */
  location?: string;
  /** Body of the testimonial. Verbatim from owner. */
  quote: string;
  /** Numeric rating, 1–5. Defaults to 5 (matches the visible UI). */
  rating?: 1 | 2 | 3 | 4 | 5;
  /** ISO date string. TODO: ask owner for real dates when available. */
  datePublished?: string;
  /** Where the review was originally posted. TODO Phase 12. */
  source?: ReviewSource;
  /** Optional URL to the original review (for `sameAs` on Person, etc.). */
  sourceUrl?: string;
  /** Two-letter initials for the avatar circle. Derived if omitted. */
  initials?: string;
  /**
   * Customer profile photo URL — when set, replaces the initials avatar
   * with a circular image. Tier 1.5 addition; only use photos the
   * customer has explicitly approved for marketing use.
   */
  photoUrl?: string;
  /**
   * Visible "verified" badge on the testimonial card. Set to the source
   * the review was confirmed against. Strongest trust signal when paired
   * with sourceUrl pointing to the live profile. Tier 1.5 addition.
   */
  verifiedBadge?: 'google' | 'facebook' | 'bbb' | null;
  /**
   * Short project-type tag shown at the top of the card — e.g.,
   * "Roof Replacement", "Hurricane Storm Damage", "Whole-Home Renovation".
   * Future use: filterable testimonials by project type. Tier 1.5 addition.
   */
  projectType?: string;
}

/**
 * REVIEWS — verbatim from the existing site Testimonials block.
 * To add a new review:
 *   1. Get the customer's written permission.
 *   2. Add a new entry with a unique `id`.
 *   3. Set `datePublished` to the date the review was actually given.
 *   4. Run the build — Testimonials UI + Review schema both update.
 */
export const REVIEWS: ReviewEntry[] = [
  {
    id: 'downey-2024-residential',
    author: 'Betty Downey',
    role: 'Homeowner',
    location: 'Orlando, FL',
    quote:
      'Beit Building Contractors transformed our vision into a reality, surpassing every expectation. The craftsmanship is exceptional and the team was a pleasure to work with from start to finish.',
    rating: 5,
    initials: 'BD',
    // TODO Phase 12: replace with real datePublished + source URL once
    // pulled from verified Google Business Profile.
    // datePublished: '2024-MM-DD',
    // source: 'Google',
    // sourceUrl: 'https://g.page/...',
  },
  {
    id: 'oreilly-investor-property',
    author: 'James T. O’Reilly',
    role: 'Property Investor',
    quote:
      'Their dedication and expertise ensured the success of our project. They handled everything with professionalism and delivered on time and on budget. I wouldn’t trust anyone else with my property.',
    rating: 5,
    initials: 'JT',
    // TODO Phase 12: real datePublished + source.
  },
  {
    id: 'lewis-2024-roof-replacement',
    author: 'Tom & Mandy Lewis',
    role: 'Homeowners',
    location: 'Orlando, FL',
    quote:
      'Professionalism and quality craftsmanship at its finest. Our new roof looks incredible and the entire process was smooth and transparent. Highly recommend to anyone in Central Florida.',
    rating: 5,
    initials: 'T&',
    // TODO Phase 12: real datePublished + source.
  },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Derived aggregates
 *
 * Computed from REVIEWS rather than hand-set so they can never drift from
 * the underlying data. If you add a 4th 5-star review, reviewCount → 4
 * automatically + Schema.org AggregateRating updates next render.
 * ───────────────────────────────────────────────────────────────────────── */

export interface AggregateRating {
  ratingValue: number;
  reviewCount: number;
  bestRating: 5;
  worstRating: 1;
}

export function buildAggregateRating(
  reviews: ReviewEntry[] = REVIEWS,
): AggregateRating {
  if (reviews.length === 0) {
    // Defensive — schema won't render aggregateRating with reviewCount 0,
    // but we still return a typed object so consumers don't crash.
    return { ratingValue: 0, reviewCount: 0, bestRating: 5, worstRating: 1 };
  }
  const total = reviews.reduce((sum, r) => sum + (r.rating ?? 5), 0);
  const avg = total / reviews.length;
  // Round to 1 decimal — matches Google's display precision.
  const ratingValue = Math.round(avg * 10) / 10;
  return {
    ratingValue,
    reviewCount: reviews.length,
    bestRating: 5,
    worstRating: 1,
  };
}

/** Pre-computed snapshot — convenient for components that don't need the fn. */
export const AGGREGATE_RATING = buildAggregateRating();

/** Visible rating string for UIs ("5.0 average · 3 reviews"). */
export function formatAggregateLabel(agg: AggregateRating = AGGREGATE_RATING) {
  if (agg.reviewCount === 0) return 'No reviews yet';
  return `${agg.ratingValue.toFixed(1)} average · ${agg.reviewCount} review${agg.reviewCount === 1 ? '' : 's'}`;
}
