/**
 * SceneElement — renders one modular scene element either as the SVG
 * fallback (`<use href="#rh-...">`) or as an artist-painted PNG layer
 * (`<image href="/images/scene/.../*.png">`), depending on whether
 * a raster file exists in the manifest.
 *
 * The artist round-trip:
 *   1. `node scripts/export-scene-elements.mjs` writes baseline PNGs
 *      to public/images/scene/ and updates src/data/scene-manifest.ts
 *   2. Artist edits any PNG (the canvas is full-scene 1600×960 @ 2×;
 *      the element is at its canonical scene position; rest is
 *      transparent).
 *   3. Save back to the same path.
 *   4. Re-run the export script (only updates the manifest — your
 *      polished PNG is preserved by the skip-if-exists guard).
 *   5. Refresh the dev server. <SceneElement> reads the manifest at
 *      module-load time; if your PNG is registered, it renders the
 *      raster. Otherwise it renders the SVG `<use>`.
 *
 * Why full-canvas PNG instead of cropped:
 *   The artist sees the element exactly where it would appear in the
 *   composed scene — no fiddling with offsets or coordinate frames.
 *   Open the PNG in Photoshop, paint, save. Compositing at runtime is
 *   a single GPU texture quad — paint cost identical to a tightly-
 *   cropped image.
 *
 * Sway compatibility:
 *   The parent <g> often wraps SceneElement with a transform-origin
 *   + rotate for wind sway. Because the raster <image> uses the same
 *   parent transform, the painted element rotates around the same
 *   anchor as the SVG would have. Sway "just works" without changes.
 */

import { SCENE_RASTER_INDEX } from '../../../data/scene-manifest';
import { useRasterMode } from './useRasterMode';

interface Props {
  /** Manifest key, formatted as 'category/name' (e.g. 'vegetation/oak-tree-left') */
  id: string;
  /** SVG symbol href used when no raster is registered (e.g. '#rh-oak') */
  symbolHref: string;
  /** Canonical position + size in scene coordinates — only consumed by SVG fallback */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional className passed through to whichever element renders */
  className?: string;
  /** Optional inline style — useful for opacity, tint via filter, etc. */
  style?: React.CSSProperties;
}

export function SceneElement({ id, symbolHref, x, y, w, h, className, style }: Props) {
  // The artist's A/B toggle. When 'off' (set via ?raster=off URL param
  // or Alt+R keyboard), every SceneElement falls back to its SVG <use>
  // regardless of manifest entries — useful for visually comparing the
  // painted scene against the original SVG. See useRasterMode.ts for
  // the toggle's contract.
  const rasterMode = useRasterMode();
  const entry = SCENE_RASTER_INDEX[id];
  if (rasterMode === 'on' && entry) {
    // RASTER MODE — full-canvas image layer. Compositing is GPU; cost
    // is one textured quad regardless of how much of the image is
    // transparent. preserveAspectRatio="xMidYMid meet" so the artist
    // can save at any output size and the runtime maps it back to the
    // 800×480 scene viewBox without distortion.
    return (
      <image
        href={entry.href}
        x={0}
        y={0}
        width={800}
        height={480}
        preserveAspectRatio="xMidYMid meet"
        className={className}
        style={style}
      />
    );
  }
  // SVG FALLBACK — symbol at canonical position. This is the default
  // when no raster has been exported / painted yet for this element.
  return (
    <use
      href={symbolHref}
      x={x}
      y={y}
      width={w}
      height={h}
      className={className}
      style={style}
    />
  );
}
