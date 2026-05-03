/**
 * Scene element exporter.
 *
 * Reads PatternDefs.tsx, extracts each <symbol> definition, then writes
 * one full-canvas (1600×960 = 800×480 @ 2× retina) transparent PNG per
 * scene element placement. The element appears at its canonical scene
 * position; the rest of the canvas is fully transparent. Open any PNG
 * in Photoshop / Procreate / Krita and the element is exactly where
 * it would be in the final scene — paint over it, save, and the
 * runtime picks up your version automatically.
 *
 * Usage:
 *   node scripts/export-scene-elements.mjs           — generate missing PNGs only
 *   node scripts/export-scene-elements.mjs --force   — regenerate everything
 *   node scripts/export-scene-elements.mjs --list    — list elements with status
 *   node scripts/export-scene-elements.mjs --watch   — watch the scene/ folder
 *                                                       and auto-refresh the
 *                                                       manifest as PNGs are
 *                                                       added / saved / removed
 *
 * Output:
 *   public/images/scene/{category}/{name}.png
 *   src/data/scene-manifest.ts  (auto-updated index of which PNGs exist)
 *
 * Round-trip:
 *   1. Run this script → baseline PNGs appear in public/images/scene/
 *   2. Edit any PNG in your raster tool of choice
 *   3. Save back to the same path (the script's "skip-if-exists" guard
 *      protects your edits on subsequent runs)
 *   4. Refresh dev server — the visualizer renders your PNG instead of
 *      the SVG fallback for that element.
 *
 * The script SKIPS files that already exist by default so re-running
 * never overwrites your art. Pass --force to regenerate everything
 * from the live SVG.
 */

import sharp from 'sharp';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PATTERN_DEFS = resolve(ROOT, 'src/components/WindUpliftVisualizer/scene/PatternDefs.tsx');
const OUT = resolve(ROOT, 'public/images/scene');
const MANIFEST = resolve(ROOT, 'src/data/scene-manifest.ts');

const SCENE_W = 800;
const SCENE_H = 480;
const SCALE = 2; // 2× retina

const FORCE = process.argv.includes('--force');
const LIST_ONLY = process.argv.includes('--list');
const WATCH = process.argv.includes('--watch');

/**
 * Element placements. Each entry maps a scene placement to a symbol +
 * canonical position + tint color (for `currentColor`-driven SVG fills).
 * Coordinates copied from Landscape.tsx + SkyAtmosphere.tsx — keep in
 * sync if those positions move.
 *
 * Categories mirror the scene's logical layers, back-to-front:
 *   sky/         — above-horizon atmosphere (clouds, treeline)
 *   background/  — distant elements behind the house (BG palms)
 *   house/       — the structure itself (no entries yet — placeholder)
 *   foreground/  — in front of the house (oaks, bushes, hibiscus, etc.)
 *
 * Render order in the visualizer matches this back-to-front sequence,
 * so the folder order doubles as a quick reference for the artist
 * deciding which element sits in front of which.
 */
const ELEMENTS = [
  // ═════════════════════════════════════════════════════════════════════
  // SKY — above the horizon, behind everything else
  // ═════════════════════════════════════════════════════════════════════

  // ─── CLOUDS (SkyAtmosphere.tsx) ──────────────────────────────────────
  { category: 'sky', name: 'cloud-bg-1',   symbolId: 'rh-cloud', x: -200, y: 55,  w: 320, h: 60, color: '#e8eef5' },
  { category: 'sky', name: 'cloud-bg-2',   symbolId: 'rh-cloud', x: 220,  y: 38,  w: 280, h: 55, color: '#e8eef5' },
  { category: 'sky', name: 'cloud-bg-3',   symbolId: 'rh-cloud', x: 520,  y: 72,  w: 320, h: 60, color: '#e8eef5' },
  { category: 'sky', name: 'cloud-bg-4',   symbolId: 'rh-cloud', x: 780,  y: 48,  w: 260, h: 50, color: '#e8eef5' },
  { category: 'sky', name: 'cloud-mid-1',  symbolId: 'rh-cloud', x: -100, y: 18,  w: 280, h: 55, color: '#dde5ee' },
  { category: 'sky', name: 'cloud-mid-2',  symbolId: 'rh-cloud', x: 280,  y: -2,  w: 320, h: 60, color: '#dde5ee' },
  { category: 'sky', name: 'cloud-mid-3',  symbolId: 'rh-cloud', x: 600,  y: 28,  w: 260, h: 50, color: '#dde5ee' },
  { category: 'sky', name: 'cloud-near-1', symbolId: 'rh-cloud', x: -50,  y: -10, w: 380, h: 60, color: '#cbd6e0' },
  { category: 'sky', name: 'cloud-near-2', symbolId: 'rh-cloud', x: 350,  y: -15, w: 420, h: 65, color: '#cbd6e0' },
  { category: 'sky', name: 'cloud-near-3', symbolId: 'rh-cloud', x: 700,  y: -5,  w: 320, h: 55, color: '#cbd6e0' },

  // ─── TREELINE (SkyAtmosphere.tsx) — distant horizon silhouette ───────
  { category: 'sky', name: 'treeline-far',  symbolId: 'rh-treeline', x: 0, y: 265, w: 800, h: 22, color: '#4a6644' },
  { category: 'sky', name: 'treeline-near', symbolId: 'rh-treeline', x: 0, y: 278, w: 800, h: 22, color: '#3d5a3a' },

  // ═════════════════════════════════════════════════════════════════════
  // BACKGROUND — distant landscape, behind the house, blurred + faded
  // ═════════════════════════════════════════════════════════════════════

  // ─── BACKGROUND PALMS (LandscapeBackground in Landscape.tsx) ─────────
  { category: 'background', name: 'palm-bg-left',  symbolId: 'rh-palm', x: 0,   y: 200, w: 80, h: 200, color: '#3d6c34' },
  { category: 'background', name: 'palm-bg-right', symbolId: 'rh-palm', x: 730, y: 220, w: 60, h: 160, color: '#3d6c34' },

  // ═════════════════════════════════════════════════════════════════════
  // HOUSE — the structure itself
  // (Placeholder — house components live in HouseStructure.tsx as inline
  //  groups, not symbols, so they need a different export pipeline.
  //  Add a per-component export plan here when the artist is ready to
  //  paint walls / roof / shutters / doors as PNG layers.)
  // ═════════════════════════════════════════════════════════════════════

  // ═════════════════════════════════════════════════════════════════════
  // FOREGROUND — in front of the house, sharpest focus
  // ═════════════════════════════════════════════════════════════════════

  // ─── OAKS (LandscapeForeground in Landscape.tsx) ─────────────────────
  // OPT-IN: oaks are excluded from auto-export by default because the
  // existing rh-oak symbol embeds a separately-painted canopy PNG
  // (tree-oak-canopy.png). Auto-generating an oak baseline + adding it
  // to the manifest would cover the in-symbol canopy painting.
  // To enable rasterization for oaks: remove `skip: true` and re-run.
  // Then drop the auto-baseline into your editor and paint over it.
  { category: 'foreground', name: 'oak-tree-left',  symbolId: 'rh-oak', x: -30, y: 190, w: 220, h: 260, color: '#4a6f3a', skip: true },
  { category: 'foreground', name: 'oak-tree-right', symbolId: 'rh-oak', x: 650, y: 210, w: 180, h: 240, color: '#4a6f3a', skip: true },
  { category: 'foreground', name: 'oak-tree-mid',   symbolId: 'rh-oak', x: 270, y: 240, w: 160, h: 220, color: '#4a6f3a', skip: true },

  // ─── BUSHES (LandscapeForeground in Landscape.tsx) ───────────────────
  { category: 'foreground', name: 'bush-1', symbolId: 'rh-bush', x: 290, y: 406, w: 80, h: 32, color: '#3d5a2a' },
  { category: 'foreground', name: 'bush-2', symbolId: 'rh-bush', x: 370, y: 412, w: 64, h: 28, color: '#3d5a2a' },
  { category: 'foreground', name: 'bush-3', symbolId: 'rh-bush', x: 528, y: 412, w: 70, h: 28, color: '#3d5a2a' },
  { category: 'foreground', name: 'bush-4', symbolId: 'rh-bush', x: 600, y: 408, w: 80, h: 32, color: '#3d5a2a' },
  { category: 'foreground', name: 'bush-5', symbolId: 'rh-bush', x: 660, y: 414, w: 56, h: 26, color: '#3d5a2a' },

  // ─── HIBISCUS (LandscapeForeground in Landscape.tsx) ─────────────────
  { category: 'foreground', name: 'hibiscus-1', symbolId: 'rh-hibiscus', x: 304, y: 416, w: 9, h: 9, color: '#d65a3a' },
  { category: 'foreground', name: 'hibiscus-2', symbolId: 'rh-hibiscus', x: 392, y: 420, w: 8, h: 8, color: '#d65a3a' },
  { category: 'foreground', name: 'hibiscus-3', symbolId: 'rh-hibiscus', x: 552, y: 420, w: 9, h: 9, color: '#d65a3a' },
  { category: 'foreground', name: 'hibiscus-4', symbolId: 'rh-hibiscus', x: 624, y: 416, w: 9, h: 9, color: '#d65a3a' },
  { category: 'foreground', name: 'hibiscus-5', symbolId: 'rh-hibiscus', x: 688, y: 422, w: 7, h: 7, color: '#d65a3a' },
];

/**
 * Read PatternDefs.tsx and extract each <symbol id="..."> { ... } </symbol>.
 * Returns { [symbolId]: { viewBox, inner } }.
 *
 * Stripping:
 *   • <image> tags — sharp's SVG renderer doesn't reliably resolve
 *     external image href, so we drop nested rasters. The user gets
 *     the geometry-only baseline; if they want canopy detail they can
 *     paint it themselves on the transparent canvas.
 *   • {jsx-expr} curly braces — JSX expressions can't be evaluated
 *     statically. Replaced with the empty string. Loses any conditional
 *     subpaths but keeps the structural geometry intact.
 */
async function extractSymbols() {
  const src = await readFile(PATTERN_DEFS, 'utf8');
  const re = /<symbol\s+id="([^"]+)"\s+viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
  const out = {};
  for (const m of src.matchAll(re)) {
    const id = m[1];
    const viewBox = m[2];
    let inner = m[3];
    // Strip nested <image> tags (self-closing or paired)
    inner = inner.replace(/<image\b[^>]*\/>/g, '').replace(/<image\b[\s\S]*?<\/image>/g, '');
    // Strip JSX comments {/* ... */} — they aren't valid in raw SVG
    inner = inner.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
    // Strip JSX curly expressions iteratively until fixed point. The
    // single-pass regex /\{[^{}]*\}/g only catches innermost braces —
    // outer wrappers like `{ARRAY.map((y,i) => <el cx={y}/>)}` survive
    // until the inner `{y}` is gone. Loop until nothing changes so any
    // depth of nesting collapses cleanly.
    let prev;
    do {
      prev = inner;
      inner = inner.replace(/\{[^{}]*\}/g, '');
    } while (inner !== prev);
    // After curly-stripping, JSX-only syntax (arrow bodies, fragments)
    // may leave dangling tokens. Drop the most common ones.
    inner = inner.replace(/=>\s*\(/g, ' (')      // arrow → open paren
                 .replace(/\(\s*<>/g, '<g>')     // fragment open
                 .replace(/<\/>\s*\)/g, '</g>'); // fragment close
    // Convert className → class for raw XML compatibility
    inner = inner.replace(/className=/g, 'class=');
    out[id] = { viewBox, inner };
  }
  return out;
}

/** Build the standalone SVG that renders one element at its scene position. */
function buildSvg({ symbolId, viewBox, inner, x, y, w, h, color }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_W * SCALE}" height="${SCENE_H * SCALE}" viewBox="0 0 ${SCENE_W} ${SCENE_H}">
  <defs>
    <symbol id="${symbolId}" viewBox="${viewBox}">${inner}</symbol>
  </defs>
  <g style="color: ${color || '#666666'}">
    <use href="#${symbolId}" x="${x}" y="${y}" width="${w}" height="${h}"/>
  </g>
</svg>`;
}

/**
 * Write the manifest TS file. Lists every PNG that currently exists in
 * public/images/scene/, by category. Imported at runtime so the SceneElement
 * component knows whether to render a raster overlay or the SVG fallback.
 */
async function writeManifest() {
  const entries = {};
  if (existsSync(OUT)) {
    const cats = await readdir(OUT, { withFileTypes: true });
    for (const cat of cats) {
      if (!cat.isDirectory()) continue;
      const files = await readdir(join(OUT, cat.name));
      entries[cat.name] = files
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.replace(/\.png$/, ''))
        .sort();
    }
  }
  const body = `/**
 * Scene raster manifest — AUTO-GENERATED by scripts/export-scene-elements.mjs.
 * Lists every PNG present in public/images/scene/, grouped by category.
 * The visualizer's <SceneElement> component checks this manifest to decide
 * whether to render an artist-painted PNG layer or fall back to the SVG.
 *
 * DO NOT EDIT BY HAND — re-run \`node scripts/export-scene-elements.mjs\`.
 */
export interface SceneRasterEntry {
  category: string;
  name: string;
  /** URL the runtime fetches from public/images/scene/ */
  href: string;
}

export const SCENE_RASTER_INDEX: Record<string, SceneRasterEntry> = ${
    JSON.stringify(
      Object.fromEntries(
        Object.entries(entries).flatMap(([cat, names]) =>
          names.map((n) => [`${cat}/${n}`, {
            category: cat,
            name: n,
            href: `/images/scene/${cat}/${n}.png`,
          }]),
        ),
      ),
      null,
      2,
    )
  };

/** Convenience helper — true when the named element has a painted PNG. */
export function hasRaster(category: string, name: string): boolean {
  return Boolean(SCENE_RASTER_INDEX[\`\${category}/\${name}\`]);
}
`;
  await mkdir(dirname(MANIFEST), { recursive: true });
  await writeFile(MANIFEST, body, 'utf8');
}

/**
 * --list — status report for every entry in ELEMENTS. Tells the artist
 * at a glance which elements are active in the manifest, which are
 * opt-in (skip:true), and which are missing their symbol or PNG.
 */
async function listElements() {
  // Group by category for readable output
  const byCat = ELEMENTS.reduce((acc, el) => {
    (acc[el.category] ||= []).push(el);
    return acc;
  }, {});
  console.log(`\n${ELEMENTS.length} placements across ${Object.keys(byCat).length} categories:\n`);
  for (const [cat, items] of Object.entries(byCat)) {
    console.log(`  ${cat}/`);
    for (const el of items) {
      const outPath = join(OUT, el.category, `${el.name}.png`);
      const exists = existsSync(outPath);
      let status;
      if (el.skip) {
        status = '⊘ OPT-IN';
      } else if (exists) {
        status = '✓ ACTIVE';
      } else {
        status = '· missing';
      }
      console.log(`    ${status.padEnd(10)} ${el.name.padEnd(20)} → ${el.symbolId.padEnd(14)} @ (${el.x}, ${el.y}) ${el.w}×${el.h}`);
    }
  }
  console.log('\nLegend:');
  console.log('  ✓ ACTIVE   — PNG exists, registered in manifest, runtime uses raster');
  console.log('  ⊘ OPT-IN   — skip:true in script, runtime uses SVG fallback');
  console.log('  · missing  — script will export this on next `npm run export:scene`\n');
}

/**
 * --watch — keep the manifest in sync with the scene folder. fs.watch
 * fires on every save / add / delete; debounce so multi-event saves
 * (most editors fire 2-4 events per Ctrl+S) collapse into one refresh.
 *
 * Manifest writes are idempotent — same disk listing → same TS file →
 * Vite's HMR is a no-op when the content didn't change. So we can
 * refresh aggressively without worrying about disrupting the dev loop.
 */
async function watchMode() {
  await mkdir(OUT, { recursive: true });
  await writeManifest();
  console.log(`\n👁  Watching ${OUT}`);
  console.log('   manifest auto-refreshes when PNGs are added / saved / deleted');
  console.log('   Ctrl+C to stop\n');

  let timer = null;
  const refresh = (filename) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await writeManifest();
      const ts = new Date().toLocaleTimeString();
      console.log(`  [${ts}] manifest refreshed (trigger: ${filename})`);
    }, 250);
  };

  const watcher = watch(OUT, { recursive: true }, (event, filename) => {
    if (filename && (filename.endsWith('.png') || filename.endsWith('.webp'))) {
      refresh(filename);
    }
  });

  // Hold the process open + clean up cleanly on Ctrl+C
  process.on('SIGINT', () => {
    watcher.close();
    if (timer) clearTimeout(timer);
    console.log('\n👋 Stopped watching.\n');
    process.exit(0);
  });

  // Block forever until SIGINT
  await new Promise(() => {});
}

async function main() {
  if (LIST_ONLY) {
    await listElements();
    return;
  }

  if (WATCH) {
    await watchMode();
    return;
  }

  console.log(`\nExporting scene elements (${SCENE_W}×${SCENE_H} @ ${SCALE}×) — ${ELEMENTS.length} placements\n`);

  const symbols = await extractSymbols();
  const found = Object.keys(symbols);
  console.log(`Symbols extracted from PatternDefs.tsx: ${found.length}`);
  console.log(`  ${found.join(', ')}\n`);

  await mkdir(OUT, { recursive: true });

  let written = 0, skipped = 0, failed = 0, missing = 0;

  for (const el of ELEMENTS) {
    if (el.skip) {
      console.log(`  ⊘ ${el.category}/${el.name} — opt-in (skip:true in script)`);
      skipped++;
      continue;
    }
    const symbol = symbols[el.symbolId];
    if (!symbol) {
      console.warn(`  ✗ ${el.name}: symbol "${el.symbolId}" not found`);
      missing++;
      continue;
    }
    const outDir = join(OUT, el.category);
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `${el.name}.png`);
    if (!FORCE && existsSync(outPath)) {
      console.log(`  · ${el.category}/${el.name}.png — exists (skipped)`);
      skipped++;
      continue;
    }
    const svg = buildSvg({ ...el, viewBox: symbol.viewBox, inner: symbol.inner });
    try {
      const png = await sharp(Buffer.from(svg))
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
      await writeFile(outPath, png);
      console.log(`  ✓ ${el.category}/${el.name}.png  (${(png.length / 1024).toFixed(1)} KB)`);
      written++;
    } catch (err) {
      console.error(`  ✗ ${el.name}: render failed — ${err.message}`);
      failed++;
    }
  }

  await writeManifest();

  console.log(`\n${written} written, ${skipped} skipped, ${failed} failed, ${missing} missing-symbols`);
  console.log(`Manifest written to src/data/scene-manifest.ts\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
