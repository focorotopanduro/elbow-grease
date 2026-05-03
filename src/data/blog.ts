/**
 * Blog data layer — auto-discovers all MDX posts via Vite's
 * `import.meta.glob` and exposes them as a typed, sorted array of Post
 * objects.
 *
 * Authoring:
 *   1. Drop a new file at src/content/blog/<slug>.mdx
 *   2. Include valid YAML frontmatter (see PostFrontmatter in types/mdx.d.ts)
 *   3. Run `npm run build:blog-routes` (or `npm run build`) to regenerate
 *      per-post HTML files and the sitemap.
 *
 * The slug is derived from the filename (sans `.mdx`). Use kebab-case.
 *
 * Categories — kept narrow on purpose. Adding a new one requires updating
 * the PostFrontmatter union in types/mdx.d.ts so TS catches typos at build.
 */

import type { ComponentType } from 'react';
import type { PostFrontmatter } from '../types/mdx';
import { LIVE_READINESS } from './liveReadiness';

const ROUGH_WORDS_PER_MINUTE = 240;

export interface Post extends PostFrontmatter {
  /** URL slug, derived from the MDX filename. */
  slug: string;
  /** The MDX-rendered React component. */
  Component: ComponentType;
  /** Computed reading time (minutes). */
  computedReadingTime: number;
}

/* ─── Discovery ───────────────────────────────────────────────────────── */

/**
 * Eagerly import every MDX file in src/content/blog at build time.
 * `eager: true` means the components + frontmatter are inlined into the
 * bundle (no dynamic chunk per post), which keeps blog navigation snappy.
 *
 * The path pattern is relative to THIS file. The `as: 'frontmatter'` style
 * isn't used because we want both the default export (component) and the
 * named export (frontmatter) — `import: '*'` gives us both via the module
 * namespace object.
 */
type MdxModule = {
  default: ComponentType;
  frontmatter: PostFrontmatter;
};

// Vite parses this glob statically — the pattern must be a literal string.
const modules = import.meta.glob<MdxModule>('../content/blog/*.mdx', {
  eager: true,
});

function slugFromPath(path: string): string {
  const match = path.match(/\/([^/]+)\.mdx$/);
  if (!match) {
    throw new Error(`blog.ts: cannot derive slug from path "${path}"`);
  }
  return match[1];
}

function computeReadingTime(fm: PostFrontmatter): number {
  if (typeof fm.readingTime === 'number') return fm.readingTime;
  if (typeof fm.wordCount === 'number') {
    return Math.max(1, Math.ceil(fm.wordCount / ROUGH_WORDS_PER_MINUTE));
  }
  // Without an explicit signal, default to a conservative 5 min so the
  // UI doesn't render "0 min read" on posts authored before this field
  // was added.
  return 5;
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/** All posts, sorted newest-first by datePublished. Includes drafts. */
export const POSTS: Post[] = Object.entries(modules)
  .map(([path, mod]) => {
    const fm = mod.frontmatter;
    if (!fm) {
      throw new Error(
        `blog.ts: ${path} missing frontmatter export. ` +
          'Every MDX post must declare YAML frontmatter at the top.',
      );
    }
    return {
      ...fm,
      slug: slugFromPath(path),
      Component: mod.default,
      computedReadingTime: computeReadingTime(fm),
    };
  })
  .sort((a, b) => b.datePublished.localeCompare(a.datePublished));

/** Live posts (drafts excluded). Use this everywhere except admin views. */
export function getLivePosts(): Post[] {
  if (!LIVE_READINESS.showBlog) return [];
  return POSTS.filter((p) => p.draft !== true);
}

/** Look up a post by slug — undefined if not found or draft. */
export function getPostBySlug(slug: string): Post | undefined {
  if (!LIVE_READINESS.showBlog) return undefined;
  return POSTS.find((p) => p.slug === slug && p.draft !== true);
}

/** Posts in a given category, live only. */
export function getPostsByCategory(category: Post['category']): Post[] {
  return getLivePosts().filter((p) => p.category === category);
}

/** Posts with a given tag, live only. */
export function getPostsByTag(tag: string): Post[] {
  return getLivePosts().filter((p) => p.tags?.includes(tag));
}

/**
 * Related posts — same category, sorted by recency, excluding the source
 * post. Falls back to most-recent-overall if there aren't enough siblings.
 */
export function getRelatedPosts(post: Post, count = 3): Post[] {
  const live = getLivePosts().filter((p) => p.slug !== post.slug);
  const sameCategory = live.filter((p) => p.category === post.category);
  if (sameCategory.length >= count) return sameCategory.slice(0, count);
  // Fill remaining slots with most-recent posts from any category.
  const filler = live
    .filter((p) => p.category !== post.category)
    .slice(0, count - sameCategory.length);
  return [...sameCategory, ...filler];
}

/** All distinct categories present in live posts. */
export function getAllCategories(): Array<Post['category']> {
  const set = new Set<Post['category']>();
  for (const p of getLivePosts()) set.add(p.category);
  return Array.from(set);
}

/** All distinct tags present in live posts. */
export function getAllTags(): string[] {
  const set = new Set<string>();
  for (const p of getLivePosts()) {
    for (const t of p.tags ?? []) set.add(t);
  }
  return Array.from(set).sort();
}

/** Format an ISO date as a human-readable label. */
export function formatPostDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : ''));
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
