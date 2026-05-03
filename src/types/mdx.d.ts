/**
 * MDX module declarations + shared frontmatter type.
 *
 * The top-level `export` makes this file a TypeScript module (not an
 * ambient declaration file), so `import type { PostFrontmatter } from
 * '../types/mdx'` resolves cleanly. The `declare module '*.mdx'` block
 * inside a module file remains a valid ambient module declaration —
 * TS still applies it to every `.mdx` import across the project.
 */

import type { ComponentType } from 'react';

export interface PostFrontmatter {
  /** Post title — used as <h1>, <title>, OG title. */
  title: string;
  /** SEO meta description. 140-160 chars. */
  description: string;
  /** ISO date the post first went live, e.g. '2026-04-28'. */
  datePublished: string;
  /** ISO date of last meaningful update. Defaults to datePublished. */
  dateModified?: string;
  /** Author display name. Defaults to "Beit Building Contractors". */
  author?: string;
  /** Top-level taxonomy. Used for related-post grouping + filters. */
  category:
    | 'company'
    | 'guide'
    | 'storm-prep'
    | 'materials'
    | 'insurance'
    | 'maintenance';
  /** Free-form tags for filtering / per-tag indexes (Phase 11). */
  tags?: string[];
  /** Hero image URL (relative to site root). 1600x900 or wider. */
  heroImage?: string;
  /** OG card image override. Falls back to heroImage, then site default. */
  ogImage?: string;
  /** Manually-set reading time in minutes. Auto-computed if omitted. */
  readingTime?: number;
  /** Word count — used by Article schema. Auto-computed if omitted. */
  wordCount?: number;
  /** Hide from index + sitemap until ready to publish. */
  draft?: boolean;
}

declare module '*.mdx' {
  // Re-imported here because ambient modules don't share top-level imports.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  import type { ComponentType as _ComponentType } from 'react';
  export const frontmatter: PostFrontmatter;
  const MDXContent: ComponentType;
  export default MDXContent;
}
