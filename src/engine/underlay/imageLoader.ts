/**
 * imageLoader — Phase 14.R.24.
 *
 * Lightweight raster-image loader for roofing blueprint underlays.
 * Reads a user-picked File (PNG / JPG / WebP / GIF) into a data URL
 * suitable for the same `useRoofStore.loadPdfImage()` call path that
 * PDF pages use — so the PDF plane code renders images without any
 * format-specific branching.
 *
 * DXF + other vector formats are NOT handled here — they need a
 * full parse-to-raster pipeline (dxf-parser + canvas rendering) and
 * will live in a separate module when shipped.
 *
 * Two public functions:
 *   • `isImageFile(file)` — MIME / extension sniff. Used by the
 *     picker to route between PDF and image code paths.
 *   • `loadImageFile(file)` — async; returns `{ dataUrl, widthPx,
 *     heightPx, fileName }`. Throws if the browser can't decode
 *     the image (corrupted / unsupported format / etc.).
 */

/** Browser-handled raster formats. GIFs animate but we snapshot frame 0. */
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

/** True when `file` is a raster image this loader can handle. */
export function isImageFile(file: File | { name?: string; type?: string }): boolean {
  const type = (file.type ?? '').toLowerCase();
  if (IMAGE_MIME_TYPES.has(type)) return true;
  const name = (file.name ?? '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export interface LoadedImage {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  fileName: string;
}

/**
 * Read a raster image file, return a PNG-style data URL plus the
 * decoded pixel dimensions. Rejects when the browser can't decode
 * the file (e.g. a misnamed `.png` that's actually a corrupted
 * blob).
 *
 * The dimensions come from a transient `<img>` element's
 * `naturalWidth` / `naturalHeight` after the `load` event fires —
 * these are the file's intrinsic pixel dimensions independent of
 * any CSS or device pixel ratio.
 */
export function loadImageFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error(`Empty data URL for ${file.name}`));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(
        new Error(`Browser could not decode image: ${file.name}`),
      );
      img.onload = () => {
        resolve({
          dataUrl,
          widthPx: img.naturalWidth,
          heightPx: img.naturalHeight,
          fileName: file.name,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
