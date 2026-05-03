import { useEffect } from 'react';
import {
  ROUTES,
  SITE_URL,
  SITE_NAME,
  LOCALE,
  DEFAULT_OG_IMAGE,
  TWITTER_HANDLE,
  absoluteUrl,
  getRouteByPath,
  type OgType,
} from '../data/routes';

/**
 * <SEO /> — declarative head injection for per-route metadata.
 *
 * The site is currently a single-page experience whose <head> is fully
 * baked at build time inside `index.html`. This component is the
 * machinery for the NEXT wave: per-city pages and blog posts that each
 * need their own title / description / canonical / OG / Twitter tags.
 *
 * Usage:
 *
 *   // explicit:
 *   <SEO
 *     path="/orlando-roofing"
 *     title="Roofing in Orlando, FL"
 *     description="..."
 *   />
 *
 *   // or pull defaults from the route manifest:
 *   <SEO path="/orlando-roofing" />
 *
 * Behaviour:
 * • Mutates document.title + the meta tag set on mount.
 * • Restores the previous values on unmount, so navigating away from
 *   a city page back to the home page (when SPA routing arrives in
 *   Phase 6) doesn't leave the city's metadata stuck.
 * • No external dependency — we don't pull in react-helmet because
 *   this site has zero runtime deps beyond React itself, and the head
 *   surface we manage is small.
 */

export interface SEOProps {
  /** URL path of the page (used as canonical + sitemap join). */
  path: string;
  /** Override <title>. Falls back to manifest entry. */
  title?: string;
  /** Override description. Falls back to manifest entry. */
  description?: string;
  /** Override OG image. Falls back to manifest entry, then site default. */
  ogImage?: string;
  /** OG type — 'website' (default) or 'article'. */
  ogType?: OgType;
  /** Author for `article` types (blog posts). */
  author?: string;
  /** ISO publication date for `article` types. */
  datePublished?: string;
  /** ISO modification date for `article` types. */
  dateModified?: string;
  /** If true, emit `<meta name="robots" content="noindex,nofollow">`. */
  noindex?: boolean;
}

interface ResolvedSEO {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  ogType: OgType;
  noindex: boolean;
  author?: string;
  datePublished?: string;
  dateModified?: string;
}

function resolve(props: SEOProps): ResolvedSEO {
  const fromManifest = getRouteByPath(props.path);
  const title = props.title ?? fromManifest?.title ?? SITE_NAME;
  const description =
    props.description ??
    fromManifest?.description ??
    'Licensed roofing and construction specialists serving Orlando.';
  const ogImage = absoluteUrl(
    props.ogImage ?? fromManifest?.ogImage ?? DEFAULT_OG_IMAGE,
  );
  const ogType: OgType =
    props.ogType ?? fromManifest?.ogType ?? 'website';
  const noindex = props.noindex ?? fromManifest?.noindex ?? false;
  return {
    title,
    description,
    canonical: absoluteUrl(props.path),
    ogImage,
    ogType,
    noindex,
    author: props.author,
    datePublished: props.datePublished,
    dateModified: props.dateModified,
  };
}

/**
 * Marker attribute used to identify meta tags WE injected so we can
 * remove them on unmount without touching tags baked into index.html.
 */
const OWNED_ATTR = 'data-seo-owner';

interface MetaSpec {
  /** name="..." or property="..." — we pick automatically based on key prefix. */
  key: string;
  content: string;
}

function metaList(seo: ResolvedSEO): MetaSpec[] {
  const list: MetaSpec[] = [
    { key: 'description', content: seo.description },
    { key: 'og:type', content: seo.ogType },
    { key: 'og:title', content: seo.title },
    { key: 'og:description', content: seo.description },
    { key: 'og:url', content: seo.canonical },
    { key: 'og:image', content: seo.ogImage },
    { key: 'og:site_name', content: SITE_NAME },
    { key: 'og:locale', content: LOCALE },
    { key: 'twitter:card', content: 'summary_large_image' },
    { key: 'twitter:title', content: seo.title },
    { key: 'twitter:description', content: seo.description },
    { key: 'twitter:image', content: seo.ogImage },
  ];
  if (TWITTER_HANDLE) list.push({ key: 'twitter:site', content: TWITTER_HANDLE });
  if (seo.noindex) list.push({ key: 'robots', content: 'noindex,nofollow' });
  if (seo.ogType === 'article') {
    if (seo.author) list.push({ key: 'article:author', content: seo.author });
    if (seo.datePublished)
      list.push({ key: 'article:published_time', content: seo.datePublished });
    if (seo.dateModified)
      list.push({ key: 'article:modified_time', content: seo.dateModified });
  }
  return list;
}

/** Decide whether a meta tag uses `name=` or `property=`. */
function attrFor(key: string): 'name' | 'property' {
  if (key.startsWith('og:') || key.startsWith('article:')) return 'property';
  return 'name';
}

function applyHead(seo: ResolvedSEO): () => void {
  // Cache the previous title so unmount can restore it. Tags we created
  // are tracked via the `data-seo-owner` attribute so we never delete
  // anything baked into index.html by mistake.
  const prevTitle = document.title;
  document.title = seo.title;

  // Canonical: there's exactly one allowed. Reuse if already present
  // (likely, since index.html ships one); otherwise create + tag as ours.
  let canonicalEl = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  let prevCanonicalHref: string | null = null;
  let canonicalCreated = false;
  if (canonicalEl) {
    prevCanonicalHref = canonicalEl.getAttribute('href');
    canonicalEl.setAttribute('href', seo.canonical);
  } else {
    canonicalEl = document.createElement('link');
    canonicalEl.rel = 'canonical';
    canonicalEl.href = seo.canonical;
    canonicalEl.setAttribute(OWNED_ATTR, 'canonical');
    document.head.appendChild(canonicalEl);
    canonicalCreated = true;
  }

  // Per-key behaviour: if a meta tag for that key already exists, we
  // overwrite its content but remember the prior value so unmount can
  // put it back. If it's new, we tag it as ours and remove on unmount.
  const ownedKeys: Array<{ key: string; created: boolean; prev: string | null }> = [];
  for (const spec of metaList(seo)) {
    const attr = attrFor(spec.key);
    let el = document.head.querySelector<HTMLMetaElement>(
      `meta[${attr}="${spec.key}"]`,
    );
    if (el) {
      ownedKeys.push({ key: spec.key, created: false, prev: el.getAttribute('content') });
      el.setAttribute('content', spec.content);
    } else {
      el = document.createElement('meta');
      el.setAttribute(attr, spec.key);
      el.setAttribute('content', spec.content);
      el.setAttribute(OWNED_ATTR, spec.key);
      document.head.appendChild(el);
      ownedKeys.push({ key: spec.key, created: true, prev: null });
    }
  }

  // Cleanup closure — restore prior state when the component unmounts.
  return () => {
    document.title = prevTitle;

    if (canonicalCreated) {
      canonicalEl?.parentNode?.removeChild(canonicalEl);
    } else if (prevCanonicalHref !== null) {
      canonicalEl?.setAttribute('href', prevCanonicalHref);
    }

    for (const owned of ownedKeys) {
      const attr = attrFor(owned.key);
      const el = document.head.querySelector<HTMLMetaElement>(
        `meta[${attr}="${owned.key}"]`,
      );
      if (!el) continue;
      if (owned.created) {
        el.parentNode?.removeChild(el);
      } else if (owned.prev !== null) {
        el.setAttribute('content', owned.prev);
      }
    }
  };
}

export default function SEO(props: SEOProps) {
  useEffect(() => {
    const seo = resolve(props);
    return applyHead(seo);
    // Re-run if any of the SEO inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.path,
    props.title,
    props.description,
    props.ogImage,
    props.ogType,
    props.author,
    props.datePublished,
    props.dateModified,
    props.noindex,
  ]);
  return null;
}

/**
 * Imperative version for non-React contexts (e.g., a custom MDX layout
 * that doesn't render through React, or unit-test setup).
 */
export function applySEO(props: SEOProps): () => void {
  return applyHead(resolve(props));
}

export { ROUTES, SITE_URL };
