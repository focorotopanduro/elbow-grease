/**
 * bootGpuProbe — one-shot GPU classification at App boot.
 *
 * Runs BEFORE the main `<Canvas>` mounts by creating a throwaway 1×1
 * offscreen canvas, acquiring a WebGL context on it, probing
 * `WEBGL_debug_renderer_info`, then immediately releasing the context.
 *
 * Why BEFORE the real Canvas:
 *   The `antialias` flag is a Canvas creation parameter — it cannot
 *   be toggled after mount. Phase 12.B's `probeWebGLContext` runs
 *   INSIDE the Canvas and so only drives tier-level decisions (DPR,
 *   shadow map size). To conditionally disable MSAA on integrated
 *   GPUs we need the classification available as a prop when the
 *   Canvas is first rendered.
 *
 * Why the result is cached:
 *   The classification is deterministic per machine — the renderer
 *   string doesn't change within a session. Re-probing would waste
 *   a context + extension lookup. Cached at module scope; reset is
 *   exposed only for tests.
 *
 * Zero telemetry. The probe result lives in memory only, used to
 * drive two boot-time rendering decisions and nothing else.
 */

import { probeWebGLContext, type GpuProbeResult } from './lowSpecDetection';

let cached: GpuProbeResult | null = null;

/**
 * Probe the GPU once at boot and return the cached classification on
 * every subsequent call. Safe to call from any code path — React
 * hooks, module-level init, etc. No React / Three.js deps.
 */
export function probeGpuAtBoot(): GpuProbeResult {
  if (cached) return cached;

  if (typeof document === 'undefined') {
    cached = { tier: 'unknown', renderer: '', reason: 'no document (SSR)' };
    return cached;
  }

  const canvas = document.createElement('canvas');
  // 1×1 is sufficient to open a context; no framebuffer allocation of
  // any meaningful size. We don't render to it.
  canvas.width = 1;
  canvas.height = 1;

  // Prefer WebGL2 for compatibility with the real renderer's context.
  // Fall back to WebGL1 on very old or constrained environments.
  const gl: WebGL2RenderingContext | WebGLRenderingContext | null =
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
    (canvas.getContext('webgl') as WebGLRenderingContext | null);

  cached = probeWebGLContext(gl);

  // Release the probe context deterministically. `WEBGL_lose_context`
  // is widely supported; if it's missing the GC cleans up eventually.
  if (gl) {
    try {
      const ext = gl.getExtension('WEBGL_lose_context');
      (ext as { loseContext?: () => void } | null)?.loseContext?.();
    } catch {
      /* non-fatal */
    }
  }

  return cached;
}

/**
 * Convenience flag. True when the boot probe classified the GPU as
 * integrated / mobile / software-rendered — the signal App.tsx uses
 * to disable MSAA and cap DPR at 1.
 */
export function isLowSpecGpu(): boolean {
  return probeGpuAtBoot().tier === 'low-spec';
}

// ── Test hooks ────────────────────────────────────────────────
//
// Tests need to reset the cache between cases since the module-level
// cache persists across renders. `__resetBootGpuProbeForTest` provides
// that + an optional override to simulate a known GPU.

export function __resetBootGpuProbeForTest(override?: GpuProbeResult | null): void {
  cached = override ?? null;
}
