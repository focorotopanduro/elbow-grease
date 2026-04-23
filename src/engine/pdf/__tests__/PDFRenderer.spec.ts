/**
 * PDFRenderer — Phase 14.E tests.
 *
 * We don't exercise actual pdfjs-dist rendering here — that requires
 * a binary PDF fixture + a DOM canvas that jsdom only partially
 * supports. Instead we pin the pure helpers that drive the rendering
 * math: dpi→scale, point→feet, DPI clamping, PDF-detection.
 *
 * Integration is verified by:
 *   • tsc clean (the full module typechecks)
 *   • vite build clean (the worker `?url` import resolves, pdfjs
 *     lazy-loads into its own chunk)
 *   • Manual test plan in ADR 036
 */

import { describe, it, expect } from 'vitest';
import {
  dpiToScale,
  pointsToFeet,
  clampDpi,
  isPdfFile,
} from '../PDFRenderer';

// ── dpiToScale ────────────────────────────────────────────────

describe('dpiToScale', () => {
  it('maps 72 dpi → scale 1 (pdfjs native)', () => {
    expect(dpiToScale(72)).toBe(1);
  });

  it('maps 144 dpi → scale 2', () => {
    expect(dpiToScale(144)).toBe(2);
  });

  it('maps 200 dpi → scale ≈ 2.778', () => {
    expect(dpiToScale(200)).toBeCloseTo(200 / 72, 4);
  });

  it('throws on zero / negative / non-finite DPI', () => {
    expect(() => dpiToScale(0)).toThrow();
    expect(() => dpiToScale(-10)).toThrow();
    expect(() => dpiToScale(Number.NaN)).toThrow();
    expect(() => dpiToScale(Infinity)).toThrow();
  });
});

// ── pointsToFeet ──────────────────────────────────────────────

describe('pointsToFeet', () => {
  it('converts 72 points (1 inch) → 1/12 foot', () => {
    expect(pointsToFeet(72)).toBeCloseTo(1 / 12, 6);
  });

  it('converts 864 points (12 inches) → 1 foot', () => {
    expect(pointsToFeet(864)).toBeCloseTo(1, 6);
  });

  it('converts 0 points → 0 feet', () => {
    expect(pointsToFeet(0)).toBe(0);
  });

  it('handles large values (blueprint-sized PDFs)', () => {
    // 36"x24" tabloid at 72 dpi: 2592 × 1728 points
    expect(pointsToFeet(2592)).toBeCloseTo(3, 4);
    expect(pointsToFeet(1728)).toBeCloseTo(2, 4);
  });
});

// ── clampDpi ──────────────────────────────────────────────────

describe('clampDpi', () => {
  it('keeps in-range values as-is', () => {
    expect(clampDpi(200)).toBe(200);
    expect(clampDpi(150)).toBe(150);
  });

  it('clamps below 72 to 72 (prevent pixelation)', () => {
    expect(clampDpi(50)).toBe(72);
    expect(clampDpi(0)).toBe(72);
    expect(clampDpi(-100)).toBe(72);
  });

  it('clamps above 400 to 400 (prevent multi-MB data URLs)', () => {
    expect(clampDpi(500)).toBe(400);
    expect(clampDpi(1000)).toBe(400);
  });

  it('falls back to 200 on NaN / Infinity (non-finite inputs)', () => {
    expect(clampDpi(Number.NaN)).toBe(200);
    expect(clampDpi(Infinity)).toBe(200);
    expect(clampDpi(-Infinity)).toBe(200);
  });

  it('rounds float inputs', () => {
    expect(clampDpi(150.7)).toBe(151);
    expect(clampDpi(150.4)).toBe(150);
  });
});

// ── isPdfFile ─────────────────────────────────────────────────

describe('isPdfFile', () => {
  function mkFile(name: string, type: string): File {
    // jsdom's File constructor accepts Blob parts + name + options
    return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type });
  }

  it('recognizes application/pdf MIME', () => {
    expect(isPdfFile(mkFile('x.pdf', 'application/pdf'))).toBe(true);
  });

  it('recognizes .pdf extension even with wrong MIME (browser quirks)', () => {
    expect(isPdfFile(mkFile('blueprint.pdf', 'application/octet-stream'))).toBe(true);
    expect(isPdfFile(mkFile('blueprint.PDF', ''))).toBe(true);
  });

  it('rejects image files', () => {
    expect(isPdfFile(mkFile('photo.png', 'image/png'))).toBe(false);
    expect(isPdfFile(mkFile('scan.jpg', 'image/jpeg'))).toBe(false);
  });

  it('rejects non-pdf extensions', () => {
    expect(isPdfFile(mkFile('notes.txt', 'text/plain'))).toBe(false);
  });
});
