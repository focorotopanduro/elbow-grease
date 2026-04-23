/**
 * lowSpecDetection — Phase 12.B tests.
 *
 * Covers:
 *   • classifyRenderer matches integrated Intel / AMD / Apple base / mobile
 *   • High-spec NVIDIA / AMD RX / Intel Arc / Apple M-Pro/Max wins even
 *     when a low-spec phrase is also present in the string
 *   • Empty / unknown renderer → "unknown"
 *   • initialTierFor maps low-spec → tier 1, everything else → tier 0
 *   • probeWebGLContext handles null context + extension-missing gracefully
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRenderer,
  initialTierFor,
  probeWebGLContext,
} from '../lowSpecDetection';

// ── classifyRenderer: low-spec hits ────────────────────────────

describe('classifyRenderer — low-spec detection', () => {
  it('Intel UHD Graphics', () => {
    const r = classifyRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620, OpenGL 4.1)');
    expect(r.tier).toBe('low-spec');
  });

  it('Intel Iris Xe (integrated)', () => {
    const r = classifyRenderer('Intel(R) Iris(R) Xe Graphics');
    expect(r.tier).toBe('low-spec');
  });

  it('Intel HD Graphics 4000 (old laptop)', () => {
    const r = classifyRenderer('Intel(R) HD Graphics 4000');
    expect(r.tier).toBe('low-spec');
  });

  it('AMD Radeon Vega 8 (integrated APU)', () => {
    const r = classifyRenderer('AMD Radeon Vega 8 Graphics');
    expect(r.tier).toBe('low-spec');
  });

  it('Apple M1 (base)', () => {
    const r = classifyRenderer('Apple M1');
    expect(r.tier).toBe('low-spec');
  });

  it('Apple M2 base', () => {
    const r = classifyRenderer('Apple M2');
    expect(r.tier).toBe('low-spec');
  });

  it('Mobile Mali GPU', () => {
    const r = classifyRenderer('Mali-G76 MC16');
    expect(r.tier).toBe('low-spec');
  });

  it('Adreno mobile GPU', () => {
    const r = classifyRenderer('Adreno (TM) 640');
    expect(r.tier).toBe('low-spec');
  });

  it('SwiftShader software renderer', () => {
    const r = classifyRenderer('Google SwiftShader');
    expect(r.tier).toBe('low-spec');
  });

  it('Microsoft Basic Render Driver (driver fallback)', () => {
    const r = classifyRenderer('Microsoft Basic Render Driver');
    expect(r.tier).toBe('low-spec');
  });
});

// ── classifyRenderer: high-spec hits ───────────────────────────

describe('classifyRenderer — high-spec detection', () => {
  it('NVIDIA RTX 3070', () => {
    const r = classifyRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070, OpenGL 4.5)');
    expect(r.tier).toBe('high-spec');
  });

  it('NVIDIA GTX 1080', () => {
    const r = classifyRenderer('NVIDIA GeForce GTX 1080');
    expect(r.tier).toBe('high-spec');
  });

  it('AMD RX 6800 XT', () => {
    const r = classifyRenderer('AMD Radeon RX 6800 XT');
    expect(r.tier).toBe('high-spec');
  });

  it('Intel Arc A770 (discrete)', () => {
    const r = classifyRenderer('Intel(R) Arc(TM) A770 Graphics');
    expect(r.tier).toBe('high-spec');
  });

  it('Apple M3 Max', () => {
    const r = classifyRenderer('Apple M3 Max');
    expect(r.tier).toBe('high-spec');
  });

  it('high-spec wins even when an iGPU phrase is also present', () => {
    // Chrome sometimes reports both in ANGLE strings.
    const r = classifyRenderer('ANGLE (Intel UHD Graphics 630 and NVIDIA GeForce RTX 3070)');
    expect(r.tier).toBe('high-spec');
  });
});

// ── classifyRenderer: unknown ──────────────────────────────────

describe('classifyRenderer — unknown / empty', () => {
  it('empty string → unknown', () => {
    const r = classifyRenderer('');
    expect(r.tier).toBe('unknown');
  });

  it('garbage string → mid-spec (best guess, adaptive loop will correct)', () => {
    const r = classifyRenderer('WeirdGPU 9000');
    expect(r.tier).toBe('mid-spec');
  });
});

// ── initialTierFor ─────────────────────────────────────────────

describe('initialTierFor', () => {
  it('low-spec → tier 1', () => {
    expect(initialTierFor('low-spec')).toBe(1);
  });

  it('mid-spec → tier 0', () => {
    expect(initialTierFor('mid-spec')).toBe(0);
  });

  it('high-spec → tier 0', () => {
    expect(initialTierFor('high-spec')).toBe(0);
  });

  it('unknown → tier 0 (assume capable, let adaptive loop correct)', () => {
    expect(initialTierFor('unknown')).toBe(0);
  });
});

// ── probeWebGLContext ──────────────────────────────────────────

describe('probeWebGLContext', () => {
  it('null context → unknown', () => {
    const r = probeWebGLContext(null);
    expect(r.tier).toBe('unknown');
    expect(r.renderer).toBe('');
  });

  it('context without WEBGL_debug_renderer_info → unknown', () => {
    // Fake context that returns null for getExtension.
    const fakeGl = {
      getExtension: () => null,
      getParameter: () => '',
    } as unknown as WebGLRenderingContext;
    const r = probeWebGLContext(fakeGl);
    expect(r.tier).toBe('unknown');
  });

  it('context with extension → classifies the returned string', () => {
    const fakeExt = { UNMASKED_RENDERER_WEBGL: 37445 };
    const fakeGl = {
      getExtension: (name: string) => (name === 'WEBGL_debug_renderer_info' ? fakeExt : null),
      getParameter: (_p: number) => 'ANGLE (Intel, Intel(R) UHD Graphics 620, OpenGL 4.1)',
    } as unknown as WebGLRenderingContext;
    const r = probeWebGLContext(fakeGl);
    expect(r.tier).toBe('low-spec');
    expect(r.renderer).toContain('Intel');
  });

  it('extension throws → catches and returns unknown', () => {
    const fakeGl = {
      getExtension: () => { throw new Error('blocked'); },
      getParameter: () => '',
    } as unknown as WebGLRenderingContext;
    const r = probeWebGLContext(fakeGl);
    expect(r.tier).toBe('unknown');
  });
});
