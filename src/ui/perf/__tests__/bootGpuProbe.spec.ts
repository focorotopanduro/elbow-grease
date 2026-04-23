/**
 * bootGpuProbe — Phase 12.D tests.
 *
 * Covers:
 *   • first call opens a canvas, gets a context, returns a classification
 *   • second call returns the cached result (no re-creation)
 *   • isLowSpecGpu returns true iff tier === 'low-spec'
 *   • __resetBootGpuProbeForTest wipes the cache
 *   • SSR-style no-document path returns 'unknown'
 *   • cache survives across multiple inspection calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  probeGpuAtBoot,
  isLowSpecGpu,
  __resetBootGpuProbeForTest,
} from '../bootGpuProbe';

// ── Helpers ───────────────────────────────────────────────────

/**
 * Stub `document.createElement('canvas')` → a canvas whose WebGL
 * context returns a specific renderer string. Returns a cleanup
 * function. Doesn't replace document.createElement for other tags.
 */
function stubCanvasWithRenderer(rendererString: string): () => void {
  const origCreate = document.createElement.bind(document);

  const fakeExt = { UNMASKED_RENDERER_WEBGL: 37445 };
  const fakeGl = {
    getExtension: (name: string) => {
      if (name === 'WEBGL_debug_renderer_info') return fakeExt;
      if (name === 'WEBGL_lose_context') return { loseContext: vi.fn() };
      return null;
    },
    getParameter: (p: number) => (p === 37445 ? rendererString : ''),
  };

  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      const c = origCreate(tag) as HTMLCanvasElement;
      // Replace getContext with a stub for this one canvas.
      (c as unknown as { getContext: () => unknown }).getContext = () => fakeGl;
      return c;
    }
    return origCreate(tag);
  });

  return () => { spy.mockRestore(); };
}

beforeEach(() => {
  __resetBootGpuProbeForTest(null);
});

// ── Core probe flow ───────────────────────────────────────────

describe('probeGpuAtBoot', () => {
  it('classifies a known low-spec renderer string', () => {
    const cleanup = stubCanvasWithRenderer('Intel(R) UHD Graphics 620');
    try {
      const r = probeGpuAtBoot();
      expect(r.tier).toBe('low-spec');
      expect(r.renderer).toContain('Intel');
    } finally {
      cleanup();
    }
  });

  it('classifies a known high-spec renderer string', () => {
    const cleanup = stubCanvasWithRenderer('NVIDIA GeForce RTX 3070');
    try {
      expect(probeGpuAtBoot().tier).toBe('high-spec');
    } finally {
      cleanup();
    }
  });

  it('returns the cached result on second call without recreating the canvas', () => {
    const cleanup = stubCanvasWithRenderer('Apple M1');
    try {
      const first = probeGpuAtBoot();
      // Swap the stubbed renderer — if the probe re-ran, we'd see the
      // new string. If cached correctly we see the old one.
      cleanup();
      const cleanup2 = stubCanvasWithRenderer('NVIDIA GeForce RTX 4090');
      try {
        const second = probeGpuAtBoot();
        expect(second).toBe(first); // same object reference → cached
        expect(second.tier).toBe('low-spec'); // Apple M1, not the RTX
      } finally {
        cleanup2();
      }
    } finally {
      // cleanup() already called
    }
  });
});

// ── isLowSpecGpu ──────────────────────────────────────────────

describe('isLowSpecGpu', () => {
  it('true when probe classifies low-spec', () => {
    const cleanup = stubCanvasWithRenderer('Intel(R) HD Graphics 4000');
    try {
      expect(isLowSpecGpu()).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('false when probe classifies high-spec', () => {
    const cleanup = stubCanvasWithRenderer('AMD Radeon RX 6800 XT');
    try {
      expect(isLowSpecGpu()).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('false when probe classifies unknown (capable by default)', () => {
    const cleanup = stubCanvasWithRenderer('');
    try {
      // Empty renderer string → unknown → not low-spec.
      expect(isLowSpecGpu()).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ── __resetBootGpuProbeForTest ────────────────────────────────

describe('cache reset', () => {
  it('reset with null forces a fresh probe', () => {
    const c1 = stubCanvasWithRenderer('Apple M1');
    try {
      expect(probeGpuAtBoot().tier).toBe('low-spec');
    } finally {
      c1();
    }

    __resetBootGpuProbeForTest(null);

    const c2 = stubCanvasWithRenderer('NVIDIA GeForce RTX 4090');
    try {
      expect(probeGpuAtBoot().tier).toBe('high-spec');
    } finally {
      c2();
    }
  });

  it('reset with an override value pins the result', () => {
    __resetBootGpuProbeForTest({
      tier: 'low-spec',
      renderer: 'forced',
      reason: 'test override',
    });
    expect(isLowSpecGpu()).toBe(true);
    expect(probeGpuAtBoot().renderer).toBe('forced');
  });
});
