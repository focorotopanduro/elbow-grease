/**
 * Logo optimizer — generates web-sized assets from the high-res originals.
 *
 * Originals expected at:
 *   public/logo.png       (full crest + "BEIT BUILDING CONTRACTORS LLC" text)
 *   public/logo-mark.png  (mark only — geometric crest)
 *
 * Outputs (all preserving alpha):
 *   public/logo.png             →  optimized 1200×1200 px PNG (replaces in-place)
 *   public/logo.webp            →  same, modern format (smaller)
 *   public/logo-mark.png        →  optimized 512×512 px PNG (replaces in-place)
 *   public/logo-mark.webp       →  same, modern format
 *   public/logo-mark@2x.png     →  256×256 (for hi-DPI nav use)
 *   public/logo-mark@1x.png     →  128×128 (low-DPI fallback)
 *
 * Run with:  node scripts/optimize-logos.mjs
 */

import sharp from 'sharp';
import { readFileSync, statSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');

function fmtKB(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

async function process(inputName, sizes) {
  const inputPath = resolve(PUBLIC, inputName);
  if (!existsSync(inputPath)) {
    console.warn(`[skip] ${inputName} — not found`);
    return;
  }
  const original = statSync(inputPath).size;
  const buffer = readFileSync(inputPath);
  console.log(`\n${inputName}  →  original ${fmtKB(original)}`);

  // Move original to a backup
  const backup = inputPath + '.original.bak';
  if (!existsSync(backup)) {
    renameSync(inputPath, backup);
  }
  const sourceBuffer = existsSync(backup) ? readFileSync(backup) : buffer;

  for (const { name, size, format = 'png' } of sizes) {
    const out = resolve(PUBLIC, name);
    let img = sharp(sourceBuffer).resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    if (format === 'webp') img = img.webp({ quality: 88 });
    else img = img.png({ compressionLevel: 9, palette: false, quality: 90 });
    await img.toFile(out);
    const after = statSync(out).size;
    console.log(`   → ${name.padEnd(28)}  ${fmtKB(after)}`);
  }
}

await process('logo.png', [
  { name: 'logo.png', size: 1200, format: 'png' },
  { name: 'logo.webp', size: 1200, format: 'webp' },
]);

await process('logo-mark.png', [
  { name: 'logo-mark.png', size: 512, format: 'png' },
  { name: 'logo-mark.webp', size: 512, format: 'webp' },
  { name: 'logo-mark@2x.png', size: 256, format: 'png' },
  { name: 'logo-mark@1x.png', size: 128, format: 'png' },
]);

console.log('\nDone. Originals saved as .original.bak — delete when satisfied.');
