/**
 * BreadcrumbList schema helper — emits the canonical Schema.org form.
 *
 * Used by:
 *   - City pages (Phase 6+) — Home > [City]
 *   - Blog posts (Phase 9+) — Home > Blog > [Post]
 *   - Future deeper pages — Home > Services > [Service] > [Sub-page]
 *
 * Reference: https://schema.org/BreadcrumbList
 *            https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
 */

import { URL as SITE_URL } from '../business';

export interface BreadcrumbItem {
  /** Display name in the breadcrumb trail. */
  name: string;
  /** URL — relative paths are auto-joined with SITE_URL. */
  url: string;
}

/** Stable @id for the breadcrumb on a given page. */
export const breadcrumbId = (pagePath: string) =>
  `${SITE_URL}${pagePath.startsWith('/') ? '' : '/'}${pagePath}#breadcrumb`;

function absUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const tail = url.startsWith('/') ? url : `/${url}`;
  return `${SITE_URL}${tail}`;
}

/**
 * Build a BreadcrumbList entity. Pass the page path as the `pagePath`
 * argument so the @id is stable across renders.
 *
 *   buildBreadcrumbList('/orlando-roofing', [
 *     { name: 'Home', url: '/' },
 *     { name: 'Orlando Roofing', url: '/orlando-roofing' },
 *   ])
 */
export function buildBreadcrumbList(
  pagePath: string,
  items: BreadcrumbItem[],
) {
  return {
    '@type': 'BreadcrumbList',
    '@id': breadcrumbId(pagePath),
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      item: absUrl(it.url),
    })),
  };
}
