/**
 * City data — type definitions for per-city service-area landing pages.
 *
 * One CityData object lives per city we target (Orlando, Winter Park,
 * Oviedo, Kissimmee, …). Each is a self-contained content blob that drives:
 *   - The visible CityPage component (src/pages/CityPage.tsx)
 *   - The per-city JSON-LD graph (src/data/schemas/city.ts)
 *   - The sitemap entry (referenced by slug)
 *   - The city HTML entrypoint (orlando-roofing.html, etc.)
 *
 * Shared resources (testimonials, FAQs, services, NAP) are NEVER inlined
 * into city data. They're referenced by id (testimonialIds, faqIds) so a
 * single source of truth governs both the home page and every city page.
 */

import type { ServiceTag } from '../faqs';

export interface CityHeroCopy {
  /** H1 — should include city name + service intent (SEO). */
  headline: string;
  /** Sub-paragraph under H1 — 1-2 sentences max. */
  sub: string;
  /** Primary CTA button label, e.g., "Free Roof Inspection". */
  ctaLabel: string;
  /** Secondary CTA, optional, e.g., "Call (407) 942-6459". */
  secondaryCtaLabel?: string;
  /**
   * Override primary CTA href. Default '#contact' (jumps to the on-page
   * Contact form). Storm-damage / emergency pages set this to a tel: link
   * so the phone tap is the primary action.
   */
  primaryCtaHref?: string;
  /**
   * Override secondary CTA href. Default 'tel:+14079426459' (the call link).
   * Emergency pages can set this to '#contact' so the form is the
   * secondary action and the phone is primary.
   */
  secondaryCtaHref?: string;
}

export interface CityWhyUsPoint {
  /** Short headline (4-6 words). */
  title: string;
  /** Body copy (1-2 sentences). */
  body: string;
}

export interface CityServiceHighlight {
  /** Which top-level service this highlights. */
  serviceId: ServiceTag;
  /** City-specific headline for the service block. */
  headline: string;
  /** 2-3 sentence body — local angle (codes, neighborhoods, materials). */
  body: string;
}

export interface CityProjectPhoto {
  /** Image filename slug under /public/images/projects/<city-slug>/<slug>.{webp,jpg}. */
  slug: string;
  /** Alt text (a11y + SEO). */
  alt: string;
  /** Optional caption shown on hover or under the image. */
  caption?: string;
}

export interface CityData {
  /** URL slug (matches site-routes.json path without leading slash). */
  slug: string;
  /** Display name, e.g., "Orlando". */
  name: string;
  /** Containing county. Used in copy + schema. */
  county: string;
  /** Two-letter state code. */
  state: 'FL';
  /** Primary geo coords for the city. */
  geo: { lat: number; lng: number };
  /** Optional population — TODO until verified by owner. */
  population?: number;
  /**
   * Neighborhoods we work in. Surfaced in schema's `containedInPlace` and
   * referenced in copy (e.g., "from Audubon Park to Lake Eola Heights").
   */
  neighborhoods: string[];
  /** 1-2 sentences on local hurricane / climate considerations. */
  hurricaneRiskNotes: string;
  hero: CityHeroCopy;
  /** Intro section paragraphs (4-6 sentences total). */
  intro: string[];
  /** 4 trust points — content auditable + city-specific where possible. */
  whyUs: CityWhyUsPoint[];
  /** Per-service city-specific highlights (one per top-level service). */
  serviceHighlights: CityServiceHighlight[];
  /** Project gallery — TODO photos for placeholder cities. */
  localProjects: CityProjectPhoto[];
  /**
   * Review ids referencing src/data/reviews.ts. Filter the canonical
   * REVIEWS list down to these for both UI + Review schema.
   */
  testimonialIds: string[];
  /**
   * FAQ ids referencing src/data/faqs.ts. Filter the canonical FAQS list
   * for the on-page accordion + FAQPage schema.
   */
  faqIds: string[];
  /** Google Maps embed URL (the `embed` URL, not the share URL). */
  mapEmbed: string;
  /**
   * Optional GeoShape polygon — encoded as a string of "lat,lng lat,lng …"
   * pairs per Schema.org spec. Used in city schema's areaServed for tighter
   * geographic targeting.
   */
  serviceAreaPolygon?: string;
  /**
   * Soft launch flag. When true, the page renders but is excluded from
   * the sitemap (via site-routes.json) and meta robots includes noindex.
   * Useful while content is being filled in.
   */
  draft?: boolean;
}
