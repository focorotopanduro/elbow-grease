/**
 * Public launch switches.
 *
 * Anything that depends on owner-supplied proof, approved photos, verified
 * review sources, or production scheduling links stays off until the data is
 * ready. This keeps the live site honest while letting the unfinished modules
 * remain in the codebase for later.
 */
import flags from './liveReadiness.json';

export const SHOW_BEFORE_AFTER = false;
export const SHOW_PROJECT_PORTFOLIO = false;
export const SHOW_STATS = false;
export const SHOW_TESTIMONIALS = false;
export const SHOW_REVIEW_SCHEMA = false;
export const SHOW_CITY_PROJECT_GALLERIES = false;
export const SHOW_BLOG = false;

export const LIVE_READINESS = {
  showBeforeAfter: SHOW_BEFORE_AFTER,
  showProjectPortfolio: SHOW_PROJECT_PORTFOLIO,
  showStats: SHOW_STATS,
  showTestimonials: SHOW_TESTIMONIALS,
  showReviewSchema: SHOW_REVIEW_SCHEMA,
  showCityProjectGalleries: SHOW_CITY_PROJECT_GALLERIES,
  showBlog: SHOW_BLOG,
} as const satisfies Readonly<typeof flags>;
