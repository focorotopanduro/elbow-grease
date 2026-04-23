/**
 * PDFRenderer — Phase 14.E
 *
 * Converts a PDF blueprint into raster image data URLs that the
 * backdrop system can consume as textured floor planes.
 *
 * This module is lazy-loaded (see `loadPdfRenderer` in
 * `src/core/lazy/loaders.ts`). The ~300 KB `pdfjs-dist` chunk +
 * its separate worker asset only ship when the user actually
 * imports a PDF — the rest of the app pays zero bundle cost.
 *
 * Worker setup uses Vite's `?url` convention: pdfjs-dist's worker
 * file is emitted as a standalone asset + we get back a URL that
 * pdfjs can fetch at runtime. No webpack-copy plugin, no manual
 * worker path management.
 */

import * as pdfjsLib from 'pdfjs-dist';
// `?url` tells Vite to emit the worker file as a separate bundled
// asset (with a content hash for cache-busting) and return its URL
// as the import value. Works in dev, in vite build, and in Tauri.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Vite virtual module suffix
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ── Types ─────────────────────────────────────────────────────

export interface PdfPageImage {
  /** PNG data URL suitable for direct consumption by `<img>` / THREE.TextureLoader. */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** 1-indexed page number within the source PDF. */
  pageNumber: number;
  /** The DPI the page was rendered at. */
  dpi: number;
}

export interface PdfPageInfo {
  pageNumber: number;
  /** Page dimensions in PostScript points (72 pt = 1 in). */
  widthPt: number;
  heightPt: number;
}

export interface PdfMetadata {
  numPages: number;
  pages: PdfPageInfo[];
}

// ── Helpers (pure, exported for unit tests) ───────────────────

/**
 * DPI → viewport scale. pdfjs `getViewport({ scale })` interprets
 * `scale` such that `scale = 1` yields a viewport sized in PS points
 * (72 pt = 1 in). Multiplying by `dpi / 72` gives the pixel count.
 *
 * Exposed separately so the math is unit-testable without pdfjs.
 */
export function dpiToScale(dpi: number): number {
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new Error(`dpi must be a positive finite number, got ${dpi}`);
  }
  return dpi / 72;
}

/**
 * Points → feet. Blueprints are typically drawn at real scale
 * (architectural scale per inch). At a default "blueprint is
 * 1 inch = 1 inch" assumption, points / 72 gives inches, / 12
 * gives feet. Contractor calibrates via the scale tool (K)
 * anyway; this is only a seed value for the initial widthFt.
 */
export function pointsToFeet(pts: number): number {
  return pts / 72 / 12;
}

/**
 * Clamp the rendering DPI to a sensible band. Too low → pixelated
 * blueprint. Too high → multi-MB dataURLs that choke localStorage.
 */
export function clampDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return 200;
  return Math.max(72, Math.min(400, Math.round(dpi)));
}

// ── Public API ────────────────────────────────────────────────

/**
 * Read a PDF file and return per-page metadata without rendering.
 * Used to drive the page-picker modal for multi-page PDFs.
 */
export async function readPdfMetadata(file: File | Blob): Promise<PdfMetadata> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: PdfPageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ pageNumber: i, widthPt: vp.width, heightPt: vp.height });
  }
  return { numPages: doc.numPages, pages };
}

/**
 * Render a specific page of a PDF to a PNG data URL at the given DPI.
 */
export async function renderPdfPage(
  file: File | Blob,
  pageNumber: number,
  dpi: number = 200,
): Promise<PdfPageImage> {
  const safeDpi = clampDpi(dpi);
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(
      `Page ${pageNumber} out of range (1..${doc.numPages})`,
    );
  }
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpiToScale(safeDpi) });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to obtain 2D canvas context');

  // pdfjs 4.x: `canvasContext` is required; `viewport` drives the
  // transform. We paint white first so transparent PDFs (which are
  // common for CAD exports) read as white background on the textured
  // plane, not black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthPx: canvas.width,
    heightPx: canvas.height,
    pageNumber,
    dpi: safeDpi,
  };
}

/** Convenience: render the first page. */
export async function renderFirstPage(
  file: File | Blob,
  dpi: number = 200,
): Promise<PdfPageImage> {
  return renderPdfPage(file, 1, dpi);
}

/**
 * Well-known MIME type + extension match for PDF files. Used by the
 * uploader to decide between the image path and the pdfjs path.
 */
export function isPdfFile(file: File): boolean {
  const name = file.name?.toLowerCase() ?? '';
  return file.type === 'application/pdf' || name.endsWith('.pdf');
}
