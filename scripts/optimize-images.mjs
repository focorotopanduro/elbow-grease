#!/usr/bin/env node
/**
 * scripts/optimize-images.mjs — image optimization pipeline.
 *
 * Takes a folder of source images + a target slug, generates
 * optimized WebP + JPEG fallbacks at the right sizes, and drops them
 * into the appropriate /public/images/projects/<city-slug>/ folder.
 *
 * USAGE:
 *   npm run optimize-images -- --source ./incoming/audubon-job
 *                              --city orlando
 *                              --slug audubon-park-tile-restoration
 *                              [--max-width 1600]
 *                              [--quality-jpg 84]
 *                              [--quality-webp 82]
 *                              [--verbose]
 *
 * OR via env vars (when calling without npm):
 *   IMG_SOURCE=./incoming/job  IMG_CITY=orlando  IMG_SLUG=foo  node scripts/optimize-images.mjs
 *
 * INPUTS:
 *   --source     Folder with source JPG/PNG/HEIC files. Filenames are
 *                preserved (sans extension) and become the suffix in
 *                the output: `<slug>-<filename>.<ext>`.
 *   --city       City slug (orlando | winter-park | oviedo | …) — must
 *                match the ProjectEntry.city value in src/data/projects.ts.
 *   --slug       Project slug (kebab-case). Becomes the prefix on
 *                output filenames: `<slug>-hero.jpg`, `<slug>-detail-1.jpg`, etc.
 *   --max-width  Output max width in px (default 1600). Aspect ratio
 *                preserved.
 *
 * OUTPUTS — for each input image `<name>.jpg`:
 *   public/images/projects/<city>/<slug>-<name>.jpg   (JPEG quality 84)
 *   public/images/projects/<city>/<slug>-<name>.webp  (WebP quality 82)
 *
 * SPECIAL FILENAMES:
 *   - `hero.*`, `before.*`, `after.*`, `detail-N.*` → naming preserved
 *   - Any other filename → kept as-is, useful for project-specific tags
 *
 * USES Sharp (already in package.json devDependencies — also used by
 * scripts/optimize-logos.mjs).
 */

import sharp from 'sharp';
import {
  readdirSync,
  statSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public', 'images', 'projects');

/* ─── Argument parsing ────────────────────────────────────────────────── */

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const env = process.env[`IMG_${name.toUpperCase().replace(/-/g, '_')}`];
  if (env) return env;
  return fallback;
}

const SOURCE = arg('source');
const CITY = arg('city');
const SLUG = arg('slug');
const MAX_WIDTH = Number(arg('max-width', '1600'));
const QUALITY_JPG = Number(arg('quality-jpg', '84'));
const QUALITY_WEBP = Number(arg('quality-webp', '82'));
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

if (!SOURCE || !CITY || !SLUG) {
  console.error('Required args: --source <folder> --city <slug> --slug <slug>');
  console.error('Optional: --max-width 1600 --quality-jpg 84 --quality-webp 82 --verbose');
  process.exit(2);
}

const VALID_CITIES = new Set([
  'orlando',
  'winter-park',
  'oviedo',
  'kissimmee',
  'sanford',
  'other',
]);
if (!VALID_CITIES.has(CITY)) {
  console.error(`Invalid --city. Allowed: ${[...VALID_CITIES].join(', ')}`);
  process.exit(2);
}

if (!existsSync(SOURCE)) {
  console.error(`Source folder not found: ${SOURCE}`);
  process.exit(2);
}

const SOURCE_ABS = resolve(SOURCE);
const OUT_DIR = resolve(PUBLIC, CITY);
mkdirSync(OUT_DIR, { recursive: true });

/* ─── Pipeline ────────────────────────────────────────────────────────── */

const SUPPORTED_INPUT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp']);

const files = readdirSync(SOURCE_ABS).filter((name) => {
  const p = join(SOURCE_ABS, name);
  if (!statSync(p).isFile()) return false;
  return SUPPORTED_INPUT.has(extname(name).toLowerCase());
});

if (files.length === 0) {
  console.warn(`No supported image files in ${SOURCE_ABS}.`);
  console.warn(`Supported: ${[...SUPPORTED_INPUT].join(', ')}`);
  process.exit(0);
}

console.log(`Optimizing ${files.length} image(s) → ${OUT_DIR}`);
console.log(`  slug=${SLUG}  city=${CITY}  max-width=${MAX_WIDTH}`);
console.log('');

let totalIn = 0;
let totalOutJpg = 0;
let totalOutWebp = 0;
const errors = [];

function fmtKB(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

for (const file of files) {
  const inputPath = join(SOURCE_ABS, file);
  const baseName = basename(file, extname(file));
  // Skip the hero / before / after / detail-N pattern detection — the
  // user can name files whatever they want; the slug + filename combo
  // produces the final output name.
  const outputBase = `${SLUG}-${baseName}`;
  const jpgOut = join(OUT_DIR, `${outputBase}.jpg`);
  const webpOut = join(OUT_DIR, `${outputBase}.webp`);

  try {
    const inputBuf = readFileSync(inputPath);
    const inputBytes = inputBuf.length;
    totalIn += inputBytes;

    const pipeline = sharp(inputBuf).rotate().resize({
      width: MAX_WIDTH,
      withoutEnlargement: true,
      fit: 'inside',
    });

    // Emit JPEG fallback
    const jpgBuf = await pipeline
      .clone()
      .jpeg({ quality: QUALITY_JPG, progressive: true, mozjpeg: true })
      .toBuffer();
    const fs = await import('node:fs/promises');
    await fs.writeFile(jpgOut, jpgBuf);
    totalOutJpg += jpgBuf.length;

    // Emit WebP
    const webpBuf = await pipeline
      .clone()
      .webp({ quality: QUALITY_WEBP, effort: 5 })
      .toBuffer();
    await fs.writeFile(webpOut, webpBuf);
    totalOutWebp += webpBuf.length;

    if (VERBOSE) {
      console.log(`  ✓ ${file} (${fmtKB(inputBytes)})`);
      console.log(`      → ${basename(jpgOut)}  ${fmtKB(jpgBuf.length)}`);
      console.log(`      → ${basename(webpOut)} ${fmtKB(webpBuf.length)}`);
    } else {
      console.log(`  ✓ ${outputBase}  jpg=${fmtKB(jpgBuf.length)}  webp=${fmtKB(webpBuf.length)}`);
    }
  } catch (err) {
    errors.push({ file, err: err instanceof Error ? err.message : String(err) });
    console.error(`  ✗ ${file}  ERROR: ${err.message ?? err}`);
  }
}

console.log('');
console.log(`Done.`);
console.log(`  Input total:  ${fmtKB(totalIn)}`);
console.log(`  JPEG total:   ${fmtKB(totalOutJpg)}  (${Math.round((totalOutJpg / totalIn) * 100)}% of source)`);
console.log(`  WebP total:   ${fmtKB(totalOutWebp)}  (${Math.round((totalOutWebp / totalIn) * 100)}% of source)`);
if (errors.length > 0) {
  console.log('');
  console.log(`${errors.length} file(s) failed:`);
  for (const { file, err } of errors) console.log(`  • ${file}: ${err}`);
  process.exit(1);
}

console.log('');
console.log(`Next: update src/data/projects.ts with the new file paths`);
console.log(`if you added a project. Image paths follow:`);
console.log(`  /images/projects/${CITY}/${SLUG}-<name>.jpg`);
