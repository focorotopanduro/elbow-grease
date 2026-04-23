/**
 * lowSpecDetection — classify the host GPU from the WebGL renderer string.
 *
 * Goal: give a NEW user on a modest laptop a smooth first impression by
 * starting AdaptiveQuality at a sensible tier instead of always tier 0.
 * An iGPU that would eventually drop to tier 2 after a few seconds of
 * stutter should just start at tier 1.
 *
 * This is a best-effort heuristic. The probe is:
 *
 *   1. Pull `WEBGL_debug_renderer_info` (available in Chromium + Firefox;
 *      Safari strips it in some contexts).
 *   2. Read `UNMASKED_RENDERER_WEBGL` — a vendor+model string like
 *      "ANGLE (Intel, Intel(R) UHD Graphics 620, OpenGL 4.1)".
 *   3. Pattern-match against known markers of integrated / low-end GPUs.
 *
 * False positives are low-risk: misclassifying a mid-range GPU as
 * "low-spec" means the user starts at tier 1 and sees slightly softer
 * shadows. AdaptiveQuality's hysteresis (ADR 024 / 12.A audit) will
 * promote them back up if they have headroom.
 *
 * False negatives: a truly low-spec device that we miss will just rely
 * on the runtime tier escalation — slightly choppier first few seconds
 * but the same end state.
 *
 * NO telemetry. NO fingerprinting. The result lives in memory only and
 * is used for ONE decision at boot.
 */

export type GpuTier = 'low-spec' | 'mid-spec' | 'high-spec' | 'unknown';

export interface GpuProbeResult {
  tier: GpuTier;
  /** Raw renderer string (empty if unavailable). Stored for diagnostics / logs. */
  renderer: string;
  /** Human-readable reason for the classification. */
  reason: string;
}

// ── Pattern library ───────────────────────────────────────────

/**
 * Known markers of integrated / low-end / mobile GPUs. If any pattern
 * matches the renderer string (case-insensitive), classify as low-spec.
 *
 * Kept deliberately conservative — false positives are fine, but we
 * don't want to misclassify a desktop RTX 4090 as "low-spec" because
 * its driver string happens to contain the word "Intel".
 */
const LOW_SPEC_PATTERNS = [
  // Intel integrated graphics (HD/UHD/Iris series). "Intel Arc" is
  // their discrete line — explicitly excluded below.
  /\bIntel\(?R?\)?\b.*\b(HD|UHD|Iris)\b/i,
  /\bIntel\(?R?\)?\b.*\bGraphics\s+\d{3,4}\b/i,

  // Mobile / integrated AMD
  /\bAMD\b.*\b(Radeon\s+(R[2-5]|Vega\s+[3-8]\b))/i,
  // Vega 8 and under, R2-R5 class, are integrated APU graphics.

  // Apple M-series integrated (base models; Pro/Max/Ultra considered
  // mid or high spec below).
  /\bApple\s+M1\b/i,
  /\bApple\s+M2\b$/i,
  /\bApple\s+M3\b$/i,

  // Mobile ARM GPUs (Mali / Adreno / PowerVR) — any hit is low-spec.
  /\b(Mali-|Adreno|PowerVR)\b/i,

  // Software renderers
  /\b(SwiftShader|Mesa\s+Software|llvmpipe)\b/i,

  // Microsoft Basic Render Driver — fallback when drivers fail.
  /\bMicrosoft\s+Basic\s+Render\b/i,
];

/**
 * Markers that CLEARLY indicate a discrete / high-end GPU even when
 * a low-spec pattern also matches. Checked first.
 */
const HIGH_SPEC_PATTERNS = [
  // NVIDIA: GTX 10xx / 16xx / RTX 20xx / 30xx / 40xx, plus workstation lines.
  /\bNVIDIA\b[^]*\b(GTX\s+\d{3,4}|RTX\s+\d{3,4}|Quadro|Tesla|A100|H100)\b/i,
  // AMD: RX 5xxx+ Navi, Vega 56/64, Radeon Pro / workstation W-series.
  /\bAMD\b[^]*\bRX\s+[5-9]\d{3}\b/i,
  /\bAMD\b[^]*\bVega\s+(5[6-9]|6[4-9])\b/i,
  /\bAMD\b[^]*\bRadeon\s+Pro\s+W\b/i,
  // Intel Arc — discrete, allowing common renderer-string annotations
  // like "(TM)" / "(R)" that appear between the vendor and model name.
  /\bIntel\b[^]*\bArc\b/i,
  // Apple M-series Pro/Max/Ultra (not base).
  /\bApple\s+M[1-9]\s+(Pro|Max|Ultra)\b/i,
];

// ── Public API ────────────────────────────────────────────────

/**
 * Probe the renderer string from a WebGLRenderingContext. Accepts the
 * context directly so tests can pass a stub. In production call
 * `probeWebGLContext(renderer.getContext())`.
 */
export function probeWebGLContext(gl: WebGLRenderingContext | WebGL2RenderingContext | null): GpuProbeResult {
  if (!gl) return { tier: 'unknown', renderer: '', reason: 'no WebGL context available' };

  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const raw = gl.getParameter((ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL);
      if (typeof raw === 'string') renderer = raw;
    }
  } catch {
    /* Safari with certain privacy settings throws; fall through. */
  }

  return classifyRenderer(renderer);
}

/**
 * Pure classification function — exposed so tests can drive known
 * renderer strings through the matcher without standing up a WebGL context.
 */
export function classifyRenderer(renderer: string): GpuProbeResult {
  if (!renderer) {
    return { tier: 'unknown', renderer, reason: 'renderer string unavailable' };
  }

  // High-spec markers take priority — some drivers put both the iGPU
  // name and the discrete GPU name in the same string, and we don't
  // want the iGPU half to win.
  for (const p of HIGH_SPEC_PATTERNS) {
    if (p.test(renderer)) {
      return { tier: 'high-spec', renderer, reason: `matched high-spec: ${p.source}` };
    }
  }

  for (const p of LOW_SPEC_PATTERNS) {
    if (p.test(renderer)) {
      return { tier: 'low-spec', renderer, reason: `matched low-spec: ${p.source}` };
    }
  }

  // No match either way — assume mid-spec. The adaptive tier loop
  // will correct us within a few seconds if we guessed wrong.
  return { tier: 'mid-spec', renderer, reason: 'no pattern match' };
}

/** Map a classification to an initial AdaptiveQuality tier. */
export function initialTierFor(tier: GpuTier): 0 | 1 | 2 {
  switch (tier) {
    case 'low-spec': return 1;
    case 'high-spec':
    case 'mid-spec':
    case 'unknown':
    default:
      return 0;
  }
}

// ── Test hooks ─────────────────────────────────────────────────

export const __testables = {
  LOW_SPEC_PATTERNS,
  HIGH_SPEC_PATTERNS,
};
