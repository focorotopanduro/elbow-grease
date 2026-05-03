/**
 * Route manifest — single source of truth for the site's routes,
 * page-level metadata, sitemap entries, and SEO defaults.
 *
 * EDITING:
 * • To add a route: append to `src/data/site-routes.json`. Set
 *   `status: "draft"` until the page is live; the sitemap generator
 *   skips drafts.
 * • To change SEO defaults: update the JSON. The build-time sitemap
 *   generator (`scripts/build-sitemap.mjs`) reads the same file so
 *   they can never drift.
 *
 * USAGE:
 * • React side: import { ROUTES, SITE_URL, getRouteByPath } and pass
 *   metadata into <SEO /> on per-route pages (city pages, blog posts).
 * • Build side: `scripts/build-sitemap.mjs` reads the JSON directly
 *   via fs — do NOT import this `.ts` file from Node scripts.
 */
import manifest from './site-routes.json';

export type RouteStatus = 'live' | 'draft';
export type OgType = 'website' | 'article';
export type Changefreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface RouteEntry {
  /** URL path beginning with `/`. Trailing slash optional, but stay consistent. */
  path: string;
  /** <title> for the page. */
  title: string;
  /** <meta name="description"> content. Aim 140–160 chars. */
  description: string;
  /** Override the default OG image for this route. Path relative to /. */
  ogImage?: string;
  /** OG type — 'website' for normal pages, 'article' for blog posts. */
  ogType?: OgType;
  /** Sitemap priority 0.0–1.0. Default 0.5. */
  priority?: number;
  /** Sitemap changefreq hint. */
  changefreq?: Changefreq;
  /** ISO date for <lastmod>. Defaults to today on build. */
  lastmod?: string;
  /** If true, omit from sitemap and add `<meta name="robots" content="noindex">`. */
  noindex?: boolean;
  /** Lifecycle marker — only `live` routes appear in the sitemap. */
  status?: RouteStatus;
  /** Free-text note explaining why a route is `draft`. Pure documentation. */
  draftReason?: string;
}

export interface SiteManifest {
  siteUrl: string;
  defaultOgImage: string;
  twitterHandle: string;
  siteName: string;
  locale: string;
  routes: RouteEntry[];
}

const TYPED = manifest as SiteManifest;

export const SITE_URL = TYPED.siteUrl;
export const DEFAULT_OG_IMAGE = TYPED.defaultOgImage;
export const SITE_NAME = TYPED.siteName;
export const LOCALE = TYPED.locale;
export const TWITTER_HANDLE = TYPED.twitterHandle;
export const ROUTES: RouteEntry[] = TYPED.routes;

/** Look up a route by URL path. Returns `undefined` if not in manifest. */
export function getRouteByPath(path: string): RouteEntry | undefined {
  return ROUTES.find((r) => r.path === path);
}

/** Routes that should appear in the sitemap (live, not noindexed). */
export function getIndexableRoutes(): RouteEntry[] {
  return ROUTES.filter(
    (r) => (r.status ?? 'live') === 'live' && !r.noindex,
  );
}

/** Build an absolute URL from a route path. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = SITE_URL.replace(/\/$/, '');
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}`;
}
