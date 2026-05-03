/**
 * Blog route generator — reads src/content/blog/*.mdx, parses YAML
 * frontmatter, and emits one HTML entry per post under blog/<slug>.html.
 *
 * Output structure (project root):
 *   blog/<slug>.html — per-post HTML with baked-in <head> meta + schema
 *
 * Vite picks these up via the dynamic glob in vite.config.ts. Each post's
 * HTML is rebuilt every prebuild — never edit them by hand.
 *
 * Frontmatter is parsed by a hand-rolled minimal YAML reader to keep the
 * dependency footprint small. The fields it understands match the
 * PostFrontmatter interface in src/types/mdx.d.ts:
 *   string         — `key: value` or `key: "quoted value"`
 *   number         — `readingTime: 6`
 *   boolean        — `draft: true`
 *   array<string>  — `tags: ['foo', 'bar']` or YAML list with `-` items
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BLOG_SRC = resolve(ROOT, 'src', 'content', 'blog');
const BLOG_OUT = resolve(ROOT, 'blog');
const SITE_URL = 'https://www.beitbuilding.com';
const LIVE_READINESS = resolve(ROOT, 'src', 'data', 'liveReadiness.json');

function blogIsLive() {
  if (!existsSync(LIVE_READINESS)) return false;
  const flags = JSON.parse(readFileSync(LIVE_READINESS, 'utf8'));
  return flags.showBlog === true;
}

/* ─── Frontmatter parsing ────────────────────────────────────────────── */

function stripQuotes(s) {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseValue(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~' || v === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }
  return stripQuotes(v);
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const fm = {};
  let currentKey = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const listItem = line.match(/^\s*-\s*(.*)$/);
    if (listItem && currentKey) {
      const value = stripQuotes(listItem[1].trim());
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(value);
      continue;
    }
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      const [, key, raw] = kv;
      currentKey = key;
      // If raw is empty AND next line is a list, defer parsing.
      if (raw.trim() === '') {
        fm[key] = [];
      } else {
        fm[key] = parseValue(raw);
        currentKey = null;
      }
    }
  }
  return fm;
}

/* ─── Per-post HTML template ──────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlForPost(slug, fm) {
  const url = `${SITE_URL}/blog/${slug}`;
  const ogImage = absolute(fm.ogImage || fm.heroImage || '/og-image.jpg');
  const author = fm.author || 'Beit Building Contractors';
  const dateModified = fm.dateModified || fm.datePublished;
  const keywords = Array.isArray(fm.tags) ? fm.tags.join(', ') : '';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0a0908" />
    <meta name="format-detection" content="telephone=yes" />

    <title>${escapeHtml(fm.title)} | Beit Building Blog</title>
    <meta name="description" content="${escapeHtml(fm.description)}" />
    ${keywords ? `<meta name="keywords" content="${escapeHtml(keywords)}" />` : ''}
    <meta name="author" content="${escapeHtml(author)}" />
    <meta name="robots" content="${fm.draft ? 'noindex,nofollow' : 'index, follow'}" />
    <link rel="canonical" href="${url}" />

    <meta property="og:type" content="article" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(fm.title)}" />
    <meta property="og:description" content="${escapeHtml(fm.description)}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:site_name" content="Beit Building Contractors" />
    <meta property="article:published_time" content="${escapeHtml(fm.datePublished)}" />
    <meta property="article:modified_time" content="${escapeHtml(dateModified)}" />
    ${fm.category ? `<meta property="article:section" content="${escapeHtml(fm.category)}" />` : ''}
    ${
      Array.isArray(fm.tags)
        ? fm.tags
            .map((t) => `<meta property="article:tag" content="${escapeHtml(t)}" />`)
            .join('\n    ')
        : ''
    }

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(fm.title)} — Beit Building" />
    <meta name="twitter:description" content="${escapeHtml(fm.description)}" />
    <meta name="twitter:image" content="${ogImage}" />

    <!-- Static LocalBusiness fallback (replaced at runtime by BlogPost). -->
    <script type="application/ld+json" data-jsonld-id="local-business">
    {
      "@context": "https://schema.org",
      "@type": ["LocalBusiness", "RoofingContractor", "GeneralContractor"],
      "name": "Beit Building Contractors LLC",
      "url": "https://www.beitbuilding.com",
      "telephone": "+1-407-942-6459",
      "email": "beitbuilding@gmail.com",
      "address": { "@type": "PostalAddress", "streetAddress": "2703 Dobbin Dr", "addressLocality": "Orlando", "addressRegion": "FL", "postalCode": "32817", "addressCountry": "US" },
      "geo": { "@type": "GeoCoordinates", "latitude": 28.5383, "longitude": -81.3792 },
      "priceRange": "$$"
    }
    </script>

    <script type="application/ld+json" data-jsonld-id="article">
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": "${url}#article",
      "headline": ${JSON.stringify(fm.title)},
      "description": ${JSON.stringify(fm.description)},
      "image": "${ogImage}",
      "datePublished": ${JSON.stringify(fm.datePublished)},
      "dateModified": ${JSON.stringify(dateModified)},
      "author": {
        "@type": "Organization",
        "name": ${JSON.stringify(author)},
        "url": "${SITE_URL}"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Beit Building Contractors LLC",
        "logo": {
          "@type": "ImageObject",
          "url": "${SITE_URL}/logo-mark.png"
        }
      },
      "mainEntityOfPage": "${url}",
      "url": "${url}"${fm.wordCount ? `,\n      "wordCount": ${fm.wordCount}` : ''}${fm.category ? `,\n      "articleSection": ${JSON.stringify(fm.category)}` : ''}${keywords ? `,\n      "keywords": ${JSON.stringify(keywords)}` : ''},
      "inLanguage": "en-US"
    }
    </script>

    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}/" },
        { "@type": "ListItem", "position": 2, "name": "Blog", "item": "${SITE_URL}/blog" },
        { "@type": "ListItem", "position": 3, "name": ${JSON.stringify(fm.title)}, "item": "${url}" }
      ]
    }
    </script>

    <link rel="icon" type="image/png" href="/logo-mark.png" />
    <link rel="apple-touch-icon" href="/logo-mark.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Barlow:wght@300;400;500;600&family=Barlow+Condensed:wght@400;500;600;700&family=Bebas+Neue&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root" data-blog-slug="${escapeHtml(slug)}"></div>
    <script type="module" src="/src/pages/blog-mount.tsx"></script>
  </body>
</html>
`;
}

function absolute(maybeRelative) {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return `${SITE_URL}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`;
}

/* ─── Runner ─────────────────────────────────────────────────────────── */

export function generateBlogRoutes() {
  // Always clear stale per-post HTML before deciding whether anything is
  // live. This prevents old article pages from surviving a launch toggle.
  if (existsSync(BLOG_OUT)) {
    const stat = statSync(BLOG_OUT);
    if (stat.isDirectory()) rmSync(BLOG_OUT, { recursive: true, force: true });
  }

  if (!blogIsLive()) {
    console.log('build-blog-routes: blog disabled by liveReadiness.json.');
    return [];
  }

  if (!existsSync(BLOG_SRC)) {
    console.log('build-blog-routes: src/content/blog/ does not exist — nothing to do.');
    return [];
  }

  // Clean stale generated HTMLs so removed posts don't ship as 404s.
  mkdirSync(BLOG_OUT, { recursive: true });

  const files = readdirSync(BLOG_SRC).filter(
    (f) => extname(f).toLowerCase() === '.mdx',
  );
  const generated = [];

  for (const file of files) {
    const slug = basename(file, '.mdx');
    const text = readFileSync(resolve(BLOG_SRC, file), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) {
      console.warn(`build-blog-routes: ${file} has no frontmatter — skipping`);
      continue;
    }
    if (!fm.title || !fm.description || !fm.datePublished) {
      console.warn(
        `build-blog-routes: ${file} missing required frontmatter (title/description/datePublished) — skipping`,
      );
      continue;
    }
    if (fm.draft === true) {
      console.log(`skip blog/${slug}.html  (draft)`);
      continue;
    }
    const out = resolve(BLOG_OUT, `${slug}.html`);
    writeFileSync(out, htmlForPost(slug, fm), 'utf8');
    generated.push({ slug, out, frontmatter: fm });
    console.log(`✓ blog/${slug}.html  ${fm.draft ? '(draft — noindex)' : ''}`);
  }

  console.log(`✓ wrote ${generated.length} blog route(s)`);
  return generated;
}

// Run unconditionally — this script is invoked exclusively as a CLI from
// npm scripts. The Windows / POSIX URL-equality dance for "is this main?"
// was buggy in practice, so we just always execute.
generateBlogRoutes();
