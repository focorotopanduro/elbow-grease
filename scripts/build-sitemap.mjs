/**
 * Sitemap generator — reads the route manifest and writes
 * public/sitemap.xml.
 *
 * INPUT:   src/data/site-routes.json
 * OUTPUT:  public/sitemap.xml
 *
 * Wired as a `prebuild` step in package.json so every `npm run build`
 * regenerates the sitemap from the source of truth. Also runnable via
 * `npm run build:sitemap` for ad-hoc regeneration.
 *
 * Design notes:
 * • Skips routes with status === "draft" so future routes can sit in
 *   the manifest (visible to anyone reading routes.ts) without leaking
 *   into the public sitemap before they're live.
 * • Skips routes with noindex === true.
 * • Defaults <lastmod> to today (YYYY-MM-DD) when the manifest entry
 *   doesn't supply one. Per-entry `lastmod` overrides this so we can
 *   pin specific dates for individual pages later.
 * • XML is hand-rolled to avoid pulling in a dep for ~10 elements.
 *   Tags are ordered alphabetically inside each <url> for stable diffs.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(ROOT, 'src', 'data', 'site-routes.json');
const OUT = resolve(ROOT, 'public', 'sitemap.xml');
const BLOG_SRC = resolve(ROOT, 'src', 'content', 'blog');
const LIVE_READINESS = resolve(ROOT, 'src', 'data', 'liveReadiness.json');

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function joinUrl(base, path) {
  const b = base.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function blogIsLive() {
  if (!existsSync(LIVE_READINESS)) return false;
  const flags = JSON.parse(readFileSync(LIVE_READINESS, 'utf8'));
  return flags.showBlog === true;
}

function urlBlock(siteUrl, route, today) {
  const loc = joinUrl(siteUrl, route.path);
  const lastmod = route.lastmod ?? today;
  const changefreq = route.changefreq ?? 'monthly';
  const priority =
    typeof route.priority === 'number' ? route.priority.toFixed(1) : '0.5';
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    `    <changefreq>${escapeXml(changefreq)}</changefreq>`,
    `    <priority>${escapeXml(priority)}</priority>`,
    '  </url>',
  ].join('\n');
}

/**
 * Read every src/content/blog/*.mdx file, parse its frontmatter, and emit
 * sitemap-shaped entries for the live posts. Mirrors the parsing logic
 * in build-blog-routes.mjs so a single source of truth (the MDX file)
 * drives both the per-post HTML generator AND the sitemap.
 */
function discoverBlogRoutes() {
  if (!blogIsLive()) return [];
  if (!existsSync(BLOG_SRC)) return [];
  const files = readdirSync(BLOG_SRC).filter(
    (f) => extname(f).toLowerCase() === '.mdx',
  );
  const routes = [];
  for (const file of files) {
    const slug = basename(file, '.mdx');
    const text = readFileSync(resolve(BLOG_SRC, file), 'utf8');
    const fm = parseFrontmatterMinimal(text);
    if (!fm) continue;
    if (fm.draft === true) continue;
    if (!fm.title || !fm.description || !fm.datePublished) continue;
    routes.push({
      path: `/blog/${slug}`,
      title: fm.title,
      description: fm.description,
      priority: 0.7,
      changefreq: 'monthly',
      lastmod: fm.dateModified || fm.datePublished,
      status: 'live',
    });
  }
  return routes;
}

/**
 * Minimal frontmatter parser — duplicates a small subset of the logic in
 * scripts/build-blog-routes.mjs to avoid cross-script imports. Handles:
 *   key: "string"
 *   key: bareword
 *   key: 12345
 *   key: true / false
 */
function parseFrontmatterMinimal(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    fm[kv[1]] = value;
  }
  return fm;
}

function buildSitemap(manifest) {
  const today = isoToday();
  const manifestIndexable = manifest.routes.filter(
    (r) => (r.status ?? 'live') === 'live' && !r.noindex,
  );
  const blogRoutes = discoverBlogRoutes();
  // Filter blog routes whose path collides with a manifest entry — the
  // manifest takes precedence. Lets us flip /blog itself in routes.json
  // without the discovery emitting a dupe.
  const manifestPaths = new Set(manifestIndexable.map((r) => r.path));
  const blogToMerge = blogRoutes.filter((r) => !manifestPaths.has(r.path));
  const indexable = [...manifestIndexable, ...blogToMerge];
  const blocks = indexable.map((r) => urlBlock(manifest.siteUrl, r, today));
  const generatedAt = new Date().toISOString();
  const draftCount = manifest.routes.length - manifestIndexable.length;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- generated ${generatedAt} — do not edit by hand. -->`,
    `<!-- ${indexable.length} indexable route(s). ${draftCount} non-indexable route(s) skipped. -->`,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...blocks,
    '</urlset>',
    '',
  ].join('\n');
}

function main() {
  const raw = readFileSync(MANIFEST, 'utf8');
  const manifest = JSON.parse(raw);

  if (!manifest.siteUrl) {
    throw new Error('site-routes.json: missing required `siteUrl`');
  }
  if (!Array.isArray(manifest.routes)) {
    throw new Error('site-routes.json: `routes` must be an array');
  }

  const xml = buildSitemap(manifest);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, xml, 'utf8');

  const manifestIndexable = manifest.routes.filter(
    (r) => (r.status ?? 'live') === 'live' && !r.noindex,
  );
  const drafts = manifest.routes.filter((r) => r.status === 'draft');
  const blogRoutes = discoverBlogRoutes();
  const manifestPaths = new Set(manifestIndexable.map((r) => r.path));
  const blogToMerge = blogRoutes.filter((r) => !manifestPaths.has(r.path));

  console.log(`✓ wrote ${OUT}`);
  console.log(`  ${manifestIndexable.length + blogToMerge.length} indexable route(s):`);
  for (const r of manifestIndexable) {
    console.log(`    • ${r.path}  (priority ${r.priority ?? 0.5})`);
  }
  for (const r of blogToMerge) {
    console.log(`    • ${r.path}  (blog post, priority ${r.priority})`);
  }
  if (drafts.length) {
    console.log(`  ${drafts.length} manifest draft route(s) skipped:`);
    for (const r of drafts) {
      const reason = r.draftReason ? `  — ${r.draftReason}` : '';
      console.log(`    • ${r.path}${reason}`);
    }
  }
}

main();
