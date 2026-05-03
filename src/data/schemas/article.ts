/**
 * Article / BlogPosting schema graph builder.
 *
 * Emits a per-post @graph including:
 *   - BlogPosting (the article itself)
 *   - BreadcrumbList (Home > Blog > [post])
 *
 * The author + publisher reference the canonical Organization @id from
 * local-business.ts so authority signals concentrate on one entity.
 *
 * Reference:
 *   https://schema.org/BlogPosting
 *   https://developers.google.com/search/docs/appearance/structured-data/article
 */

import {
  URL as SITE_URL,
  SCHEMA_IDS,
  LEGAL_NAME,
  IMAGE_URL,
} from '../business';
import { buildBreadcrumbList } from './breadcrumbs';
import type { Post } from '../blog';

function absoluteUrl(maybeRelative: string): string {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  const tail = maybeRelative.startsWith('/')
    ? maybeRelative
    : `/${maybeRelative}`;
  return `${SITE_URL}${tail}`;
}

function postUrl(post: Post): string {
  return `${SITE_URL}/blog/${post.slug}`;
}

function articleEntity(post: Post) {
  const url = postUrl(post);
  const heroImage = post.heroImage
    ? absoluteUrl(post.heroImage)
    : post.ogImage
      ? absoluteUrl(post.ogImage)
      : IMAGE_URL;
  const dateModified = post.dateModified ?? post.datePublished;
  return {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: post.title,
    name: post.title,
    description: post.description,
    image: {
      '@type': 'ImageObject',
      url: heroImage,
      contentUrl: heroImage,
    },
    datePublished: post.datePublished,
    dateModified,
    author: {
      '@type': 'Organization',
      '@id': SCHEMA_IDS.organization,
      name: post.author ?? LEGAL_NAME,
      url: SITE_URL,
    },
    publisher: { '@id': SCHEMA_IDS.organization },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    url,
    ...(typeof post.wordCount === 'number'
      ? { wordCount: post.wordCount }
      : {}),
    articleSection: post.category,
    ...(post.tags && post.tags.length > 0
      ? { keywords: post.tags.join(', ') }
      : {}),
    inLanguage: 'en-US',
    isPartOf: { '@id': `${SITE_URL}/blog#blog` },
  };
}

/**
 * Build the per-post Article JSON-LD graph. Pass to <JsonLd schema={...} />.
 */
export function buildArticleGraph(post: Post) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      articleEntity(post),
      buildBreadcrumbList(`/blog/${post.slug}`, [
        { name: 'Home', url: '/' },
        { name: 'Blog', url: '/blog' },
        { name: post.title, url: `/blog/${post.slug}` },
      ]),
    ],
  };
}

/**
 * Blog index schema — a CollectionPage describing the blog landing page.
 * Used by BlogIndex.tsx; cross-references each post via @id.
 */
export function buildBlogIndexGraph(posts: Post[]) {
  const url = `${SITE_URL}/blog`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Blog',
        '@id': `${url}#blog`,
        url,
        name: 'Beit Building Contractors — Blog',
        description:
          'Practical roofing, construction, hurricane prep, and insurance-claim guides for Central Florida homeowners.',
        publisher: { '@id': SCHEMA_IDS.organization },
        inLanguage: 'en-US',
        blogPost: posts.map((p) => ({
          '@type': 'BlogPosting',
          '@id': `${SITE_URL}/blog/${p.slug}#article`,
          headline: p.title,
          url: `${SITE_URL}/blog/${p.slug}`,
          datePublished: p.datePublished,
          dateModified: p.dateModified ?? p.datePublished,
          author: { '@id': SCHEMA_IDS.organization },
        })),
      },
      buildBreadcrumbList('/blog', [
        { name: 'Home', url: '/' },
        { name: 'Blog', url: '/blog' },
      ]),
    ],
  };
}
