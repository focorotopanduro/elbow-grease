/**
 * imageLoader — Phase 14.R.24 tests.
 *
 * Covers the `isImageFile` MIME / extension sniff. The async
 * `loadImageFile` path isn't unit-tested here — it requires a real
 * `Image` decoder + FileReader pipeline that jsdom doesn't provide.
 * That path is exercised by the RoofingPDFPanel integration.
 */

import { describe, it, expect } from 'vitest';
import { isImageFile } from '../imageLoader';

describe('isImageFile — MIME type detection', () => {
  it('accepts image/png', () => {
    expect(isImageFile({ type: 'image/png', name: 'roof.png' })).toBe(true);
  });

  it('accepts image/jpeg', () => {
    expect(isImageFile({ type: 'image/jpeg', name: 'trace.jpg' })).toBe(true);
  });

  it('accepts image/webp', () => {
    expect(isImageFile({ type: 'image/webp', name: 'x.webp' })).toBe(true);
  });

  it('accepts image/gif', () => {
    expect(isImageFile({ type: 'image/gif', name: 'animated.gif' })).toBe(true);
  });

  it('accepts image/bmp', () => {
    expect(isImageFile({ type: 'image/bmp', name: 'x.bmp' })).toBe(true);
  });

  it('rejects application/pdf', () => {
    expect(isImageFile({ type: 'application/pdf', name: 'plans.pdf' })).toBe(false);
  });

  it('rejects image/svg+xml (SVG vector — needs its own parser)', () => {
    expect(isImageFile({ type: 'image/svg+xml', name: 'logo.svg' })).toBe(false);
  });

  it('rejects text/plain', () => {
    expect(isImageFile({ type: 'text/plain', name: 'note.txt' })).toBe(false);
  });
});

describe('isImageFile — filename extension fallback', () => {
  it('accepts .png when MIME is missing', () => {
    expect(isImageFile({ type: '', name: 'roof.png' })).toBe(true);
  });

  it('accepts .jpg (case-insensitive)', () => {
    expect(isImageFile({ type: '', name: 'Roof.JPG' })).toBe(true);
  });

  it('accepts .jpeg', () => {
    expect(isImageFile({ type: '', name: 'photo.jpeg' })).toBe(true);
  });

  it('accepts .webp', () => {
    expect(isImageFile({ type: '', name: 'blueprint.webp' })).toBe(true);
  });

  it('rejects .pdf even when MIME is missing', () => {
    expect(isImageFile({ type: '', name: 'plans.pdf' })).toBe(false);
  });

  it('rejects empty name and empty MIME', () => {
    expect(isImageFile({ type: '', name: '' })).toBe(false);
    expect(isImageFile({} as { name?: string; type?: string })).toBe(false);
  });

  it('rejects .dxf (vector CAD — needs dedicated parser)', () => {
    expect(isImageFile({ type: '', name: 'drawing.dxf' })).toBe(false);
  });
});

describe('isImageFile — MIME takes precedence over extension', () => {
  it('accepts image/png even when name has no extension', () => {
    expect(isImageFile({ type: 'image/png', name: 'scan-00123' })).toBe(true);
  });

  it('accepts .png via extension even when MIME is generic', () => {
    // Some file systems / download tools report 'application/octet-stream'
    // for images. The extension fallback should still route correctly.
    expect(isImageFile({
      type: 'application/octet-stream',
      name: 'scan.png',
    })).toBe(true);
  });
});
