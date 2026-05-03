/**
 * Business profile — single source of truth for Beit Building Contractors LLC.
 *
 * Every component, schema generator, and footer/contact UI block reads from
 * this file. Editing here propagates everywhere. NEVER hand-write business
 * data in components — always import from here.
 *
 * NAP CONSISTENCY:
 *   N(ame), A(ddress), P(hone) values below MUST match exactly:
 *     - Google Business Profile listing
 *     - DBPR public license records
 *     - All citation directories (BBB, Yelp, HomeAdvisor, etc.)
 *     - Footer + Contact UI components on this site
 *   Drift in NAP causes ranking penalties. The Phase-13 NAP audit script
 *   reads this file as the canonical source.
 *
 * Data flagged with `// TODO:` is verified-pending — placeholder values
 * the owner should confirm or replace before production schema renders
 * with that data. The schema generators silently skip TODO-only fields.
 */

import { LICENSES, LAST_VERIFIED, type License } from '../components/dbprData';

/* ─────────────────────────────────────────────────────────────────────────
 * Identity
 * ───────────────────────────────────────────────────────────────────────── */

/** Legal entity name as registered with the state of Florida. */
export const LEGAL_NAME = 'Beit Building Contractors LLC';

/** Brand name used in marketing + meta titles. */
export const BRAND_NAME = 'Beit Building Contractors';

/** Short form for tight UI surfaces. */
export const SHORT_NAME = 'Beit Building';

/**
 * Alternate names that appear on official records or legacy directories.
 * Surfaced in schema `alternateName` so disambiguation queries match.
 */
export const ALTERNATE_NAMES = [
  'BEIT BUILDING CONTRACTORS LLC',
  'FL Best Construction Company',
];

/** Slogan/tagline — used in schema `slogan` and meta descriptions. */
export const SLOGAN =
  'Licensed roofing and construction specialists serving Orlando';

/** One-paragraph business description (~160 chars). */
export const DESCRIPTION =
  'Beit Building Contractors LLC provides roofing and construction services in Orlando and Central Florida: roof replacement, repairs, storm damage, decks, painting, and more.';

/** Canonical site URL — no trailing slash. */
export const URL = 'https://www.beitbuilding.com';

/** Logo URL (absolute). */
export const LOGO_URL = `${URL}/logo-mark.png`;

/** Default representative image (the OG image). */
export const IMAGE_URL = `${URL}/og-image.jpg`;

/* ─────────────────────────────────────────────────────────────────────────
 * Founder / leadership
 * ───────────────────────────────────────────────────────────────────────── */

/** Founder + qualifier of record. Same person on DBPR records. */
export const FOUNDER_NAME = 'Sandra Caroline Vasquez';

/** TODO: confirm exact founding year with owner. Currently placeholder. */
export const FOUNDING_YEAR = '2014';

/** TODO: confirm staff size band with owner. Schema accepts a range. */
export const NUMBER_OF_EMPLOYEES = { min: 5, max: 25 };

/* ─────────────────────────────────────────────────────────────────────────
 * Contact (NAP)
 * ───────────────────────────────────────────────────────────────────────── */

/** E.164-format phone for `tel:` links + schema. */
export const PHONE_E164 = '+1-407-942-6459';

/** Display-format phone — what users see. */
export const PHONE_DISPLAY = '(407) 942-6459';

/** Primary contact email. */
export const EMAIL = 'beitbuilding@gmail.com';

/** Canonical postal address (NAP-anchor for citations). */
export const ADDRESS = {
  streetAddress: '2703 Dobbin Dr',
  addressLocality: 'Orlando',
  addressRegion: 'FL',
  postalCode: '32817',
  addressCountry: 'US',
} as const;

/** One-line display form — used in Footer/Contact UIs and citation tracker. */
export const ADDRESS_DISPLAY =
  '2703 Dobbin Dr, Orlando, FL 32817';

/** Geo coordinates for the address above. Verified via Google Maps. */
export const GEO = {
  latitude: 28.5383,
  longitude: -81.3792,
} as const;

/* ─────────────────────────────────────────────────────────────────────────
 * Service area
 * ───────────────────────────────────────────────────────────────────────── */

export interface ServiceAreaEntry {
  type: 'City' | 'AdministrativeArea' | 'State';
  name: string;
  /** Optional slug if this area has a dedicated landing page. */
  slug?: string;
}

/**
 * Areas served — used in schema `areaServed` and as the data source for
 * the Phase-7+ city landing pages. Order matters: most-served first
 * (Google ranks earlier entries higher in "near me" disambiguation).
 */
export const AREA_SERVED: ServiceAreaEntry[] = [
  { type: 'AdministrativeArea', name: 'Orange County, FL' },
  { type: 'AdministrativeArea', name: 'Seminole County, FL' },
  { type: 'AdministrativeArea', name: 'Osceola County, FL' },
  { type: 'City', name: 'Orlando, FL', slug: 'orlando-roofing' },
  { type: 'City', name: 'Winter Park, FL', slug: 'winter-park-roofing' },
  { type: 'City', name: 'Oviedo, FL', slug: 'oviedo-roofing' },
  { type: 'City', name: 'Kissimmee, FL' },
  { type: 'City', name: 'Sanford, FL' },
  { type: 'City', name: 'Altamonte Springs, FL' },
  { type: 'City', name: 'Maitland, FL' },
  { type: 'City', name: 'Apopka, FL' },
  { type: 'City', name: 'Lake Mary, FL' },
  { type: 'City', name: 'Casselberry, FL' },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Operating hours
 * ───────────────────────────────────────────────────────────────────────── */

export interface HoursBlock {
  /** Schema.org day enum names. */
  days: Array<
    | 'Monday'
    | 'Tuesday'
    | 'Wednesday'
    | 'Thursday'
    | 'Friday'
    | 'Saturday'
    | 'Sunday'
  >;
  /** 24-hour opening time, e.g., '07:00'. */
  opens: string;
  /** 24-hour closing time. */
  closes: string;
}

/**
 * Hours — must match Google Business Profile exactly. If the owner adjusts
 * GBP hours, mirror them here (Phase-13 NAP audit will flag drift).
 */
export const OPENING_HOURS: HoursBlock[] = [
  {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    opens: '07:00',
    closes: '18:00',
  },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Money
 * ───────────────────────────────────────────────────────────────────────── */

/** Schema.org `priceRange` — `$`/`$$`/`$$$`/`$$$$`. */
export const PRICE_RANGE = '$$';

export const PAYMENT_ACCEPTED = [
  'Cash',
  'Check',
  'Credit Card',
  'Debit Card',
];

export const CURRENCIES_ACCEPTED = 'USD';

/* ─────────────────────────────────────────────────────────────────────────
 * Languages
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * BCP-47 language tags. Beit's crew is bilingual EN + ES — surfacing this
 * in schema lets Google match Spanish-language "techo en Orlando" queries.
 */
export const KNOWS_LANGUAGE = ['en-US', 'es'];

/* ─────────────────────────────────────────────────────────────────────────
 * Social / external profiles (sameAs)
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Verified external profiles. Each one strengthens the entity-graph that
 * Google uses for ranking. ONLY add URLs of profiles the owner has claimed
 * and that show consistent NAP. Empty placeholders are filled in Phase 12
 * (GBP) and Phase 13 (citations).
 */
export interface SameAsEntry {
  url: string;
  /** Citation-tier the source represents — for tracking in Phase 13. */
  tier?: 'S' | 'A' | 'B' | 'C';
  /** Free-form note (TODO marker, source attribution). */
  note?: string;
}

/**
 * Google Business Profile URL — set after the GBP postcard verifies.
 *
 * TODO (owner): replace `null` with the real URL from your verified GBP
 * dashboard. Format is typically `https://g.page/r/<place-id>` or the
 * longer maps.google.com canonical share URL. Setting this:
 *   1. Auto-prepends a top-tier sameAs entry to the schema graph
 *   2. Renders the "View us on Google" link in the Footer
 *   3. Strengthens the entity-graph signal Google uses for ranking
 *
 * See docs/google-business-profile-setup.md for the full GBP playbook.
 */
export const GBP_URL: string | null = null;

/**
 * Booking widget URL — set when you sign up for Calendly or Cal.com and
 * have a real public scheduling link.
 *
 * TODO (owner): replace `null` with your booking URL. Both providers
 * are auto-detected by URL host:
 *   - Calendly: 'https://calendly.com/<user>/<event-type>'
 *   - Cal.com:  'https://cal.com/<user>/<event-type>'
 *
 * Setting this:
 *   1. Reveals the BookingWidget section on the home + city pages
 *      (between FAQ and Contact / CityMap respectively).
 *   2. Lazy-loads the appropriate embed script ONLY when a visitor
 *      clicks "Open Calendar" — no third-party JS on first paint.
 *   3. Tracks `open_calendar` and `booking_completed` events into the
 *      analytics funnel for booking-vs-form A/B comparison.
 *
 * Note: vercel.json CSP includes script-src + frame-src allowlist
 * entries for both providers. If CALENDLY_URL stays null permanently,
 * those CSP entries can be tightened back (see comment in vercel.json).
 */
export const CALENDLY_URL: string | null = null;

/**
 * `sameAs` onboarding pipeline — add each verified citation URL here as it
 * goes live. Each entry strengthens the entity-graph signal Google uses to
 * confirm the business identity across the web.
 *
 * Workflow:
 *   1. Submit a citation (see `docs/citations-master-list.md` for the
 *      prioritized 50-source list).
 *   2. After verification + the listing is live + NAP is correct on the
 *      external page, copy the public profile URL.
 *   3. Add an entry below with: url + tier (S/A/B/C) + an optional note.
 *   4. Run `npm run check:nap` to confirm no NAP drift.
 *   5. Run `npm run build` and deploy — the schema + footer pick up the
 *      new sameAs entry automatically.
 *
 * The Google Business Profile URL is handled separately via the GBP_URL
 * constant above (auto-prepended at the top of SAME_AS when set).
 *
 * Tier definitions:
 *   - S — essential (GBP, Bing, Apple, Facebook, Yelp, BBB)
 *   - A — high-volume (Angi, Houzz, Nextdoor, etc.)
 *   - B — niche-helpful
 *   - C — optional / long-tail
 */
const _STATIC_SAME_AS: SameAsEntry[] = [
  // TODO Phase 13 onboarding — paste verified citation URLs below.
  // Examples (commented until each is live):
  //   { url: 'https://www.bingplaces.com/<your-place>', tier: 'S', note: 'Bing Places' },
  //   { url: 'https://www.facebook.com/beitbuilding', tier: 'S', note: 'Facebook Business Page' },
  //   { url: 'https://www.yelp.com/biz/<slug>', tier: 'S', note: 'Yelp Business' },
  //   { url: 'https://www.bbb.org/us/fl/orlando/profile/<id>/beit-building-contractors', tier: 'S', note: 'BBB' },
  //   { url: 'https://www.angi.com/companylist/us/fl/orlando/<slug>.htm', tier: 'A', note: 'Angi' },
  //   { url: 'https://www.houzz.com/professionals/<slug>', tier: 'A', note: 'Houzz' },
  //   { url: 'https://nextdoor.com/business/<slug>/', tier: 'A', note: 'Nextdoor' },
  //   { url: 'https://www.floridaroof.com/<member-slug>', tier: 'A', note: 'FRSA member' },
];

/**
 * SAME_AS — verified external profiles, with the Google Business Profile
 * URL prepended automatically when GBP_URL is set. Consumed by the
 * Schema.org entity graph (local-business.ts) as the `sameAs` field.
 */
export const SAME_AS: SameAsEntry[] = GBP_URL
  ? [
      { url: GBP_URL, tier: 'S', note: 'Google Business Profile' },
      ..._STATIC_SAME_AS,
    ]
  : _STATIC_SAME_AS;

/* ─────────────────────────────────────────────────────────────────────────
 * Service taxonomy
 * ───────────────────────────────────────────────────────────────────────── */

export interface ServiceEntry {
  /** Stable ID — also used as the URL fragment on the home page. */
  id: 'roofing' | 'general' | 'deck' | 'paint';
  /** Service name as it appears in marketing. */
  name: string;
  /** Schema.org `serviceType` taxonomy term. */
  serviceType: string;
  /** Two-sentence elevator pitch — used in Service schema description. */
  description: string;
  /** Sub-capabilities the service includes. */
  capabilities: string[];
}

/**
 * Top-level services. Mirror of the SOLUTIONS array in SolutionsGrid.tsx
 * but typed for schema generation. Phase 4 converts these into Service
 * entities; Phase 6+ uses them on city pages.
 */
export const SERVICES: ServiceEntry[] = [
  {
    id: 'roofing',
    name: 'Roofing Services',
    serviceType: 'Roofing Contractor',
    description:
      'Complete roof replacement, repair, and maintenance for residential and commercial properties. We work with all materials and assist with insurance claims every step of the way.',
    capabilities: [
      'Roof Replacement',
      'Roof Repair',
      'Storm Damage Restoration',
      'Insurance Claim Assistance',
      'Tile Roofing',
      'Shingle Roofing',
      'Metal Roofing',
      'Flat Roofing',
      'Roof Inspections',
      'Hurricane Tarping',
    ],
  },
  {
    id: 'general',
    name: 'General Construction',
    serviceType: 'General Contractor',
    description:
      'Full-scale residential and commercial construction delivered with precision. From ground-up builds to major renovations — we bring your vision to life.',
    capabilities: [
      'Residential Construction',
      'Commercial Construction',
      'Renovations',
      'Additions',
      'Structural Framing',
      'Permit Coordination',
    ],
  },
  {
    id: 'deck',
    name: 'Deck & Fence Installation',
    serviceType: 'Deck Builder',
    description:
      'Beautiful, durable outdoor spaces crafted with premium materials. Transform your backyard into the outdoor retreat you have always wanted.',
    capabilities: [
      'Deck Installation',
      'Fence Installation',
      'Pergolas',
      'Outdoor Living Spaces',
      'Composite Decking',
      'Pressure-Treated Decking',
    ],
  },
  {
    id: 'paint',
    name: 'Painting & Siding',
    serviceType: 'Painter',
    description:
      'Interior and exterior painting plus professional siding installation that protects your property while dramatically improving curb appeal.',
    capabilities: [
      'Interior Painting',
      'Exterior Painting',
      'Siding Installation',
      'Color Consultation',
      'Pressure Washing',
      'Trim & Detail Work',
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Keywords / local search hooks
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Comma-joined into schema `keywords`. Aim for high-intent commercial terms
 * paired with the service area. Avoid stuffing — Google penalizes >25.
 */
export const KEYWORDS = [
  'roofing Orlando FL',
  'roof replacement Orlando',
  'roofing contractor Orlando',
  'storm damage roofing Orlando',
  'general contractor Orlando',
  'construction company Orlando',
  'deck installation Orlando',
  'fence installation Orlando',
  'painting contractor Orlando',
  'siding installation Orlando',
  'licensed roofing contractor Florida',
  'insurance claim roofing Orlando',
];

/* ─────────────────────────────────────────────────────────────────────────
 * Licensing — re-exported from dbprData for schema-side consumers
 * ───────────────────────────────────────────────────────────────────────── */

export { LICENSES, LAST_VERIFIED };
export type { License };

/* ─────────────────────────────────────────────────────────────────────────
 * Schema entity IDs — stable URI fragments on the home page
 *
 * Using stable @id values lets cross-page schema (city pages, blog posts)
 * reference the same business entity without redefining it. This is the
 * Yoast-style schema-graph pattern that's the current best practice.
 * ───────────────────────────────────────────────────────────────────────── */

export const SCHEMA_IDS = {
  organization: `${URL}/#organization`,
  business: `${URL}/#business`,
  place: `${URL}/#place`,
  website: `${URL}/#website`,
  logo: `${URL}/#logo`,
  image: `${URL}/#primaryimage`,
  founder: `${URL}/#founder`,
} as const;
