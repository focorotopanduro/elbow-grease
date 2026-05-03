/**
 * Storm-replay cinematic — frame manifest.
 *
 * Drop WebP files into `public/cinematic/` matching the names below and
 * the cinematic overlay will activate automatically. If any file 404s,
 * the overlay silently falls back to the SVG-only experience.
 *
 * See scene/cinematic/README.md for the Blender workflow + render specs.
 */

/** Number of frames in the sequence. Change here AND ship matching files. */
export const FRAME_COUNT = 15;

/** Public-relative paths to each frame, zero-padded for natural sort. */
export const FRAMES: string[] = Array.from({ length: FRAME_COUNT }, (_, i) =>
  `/cinematic/storm-${String(i + 1).padStart(2, '0')}.webp`,
);

/**
 * Hold the final frame for this many seconds AFTER replay progress hits 1
 * before the overlay fades out. Lets the "aftermath" land emotionally
 * before revealing the SVG again.
 */
export const HOLD_FINAL_SECONDS = 1.5;

/** Fade in/out duration in ms — applied via CSS transition. */
export const FADE_MS = 500;
