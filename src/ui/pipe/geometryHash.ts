/**
 * Geometry Hash — Phase 14.AD.13.a
 *
 * Deterministic fingerprint for a `THREE.BufferGeometry`. Covers
 * positions + normals + indices in a stable serialization order
 * with fixed-precision quantization so inconsequential float drift
 * (reproducible across Chromium versions, rebuilds, different
 * runtime environments) doesn't trip false regressions.
 *
 * Used by the snapshot test suite (AD.13.b/c) to catch unintended
 * changes to pipe + fitting geometry between builds. Design goals:
 *
 *   1. **Deterministic** — identical geometry inputs → identical hash
 *      bytes, forever. No `Math.random`, no timestamp, no locale.
 *   2. **Stable across benign rebuilds** — rounding to 6 decimal
 *      places (≈ 1 µft / 0.0003 mm in plumbing units) swallows
 *      float-math drift from compiler optimizations, driver
 *      differences, or THREE.js point counts that shift by one.
 *   3. **Sensitive to real changes** — a single vertex moved by 1 mm,
 *      a different segment count, a flipped normal → different hash.
 *   4. **Short** — 16 hex chars ≈ 64 bits. Enough collision resistance
 *      for test snapshot purposes; long enough that accidental
 *      matches are astronomically unlikely.
 *   5. **Pure** — no filesystem, no clocks. Runs in any environment.
 *
 * Not cryptographic. Don't use for authentication or integrity
 * checks against an adversary. This is for "did this geometry
 * change between commits" regression detection.
 */

import * as THREE from 'three';

const PRECISION = 1e6; // 6 decimal places

/** Quantize a single float to the stable precision; preserves -0 as 0. */
function quantize(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const q = Math.round(n * PRECISION) / PRECISION;
  // Treat -0 and +0 identically so Float32Array bit patterns don't
  // produce different hashes for the same geometric value.
  return q === 0 ? 0 : q;
}

/**
 * Hash a `BufferGeometry` into a short deterministic string. Covers:
 *
 *   • vertex position count + coords (quantized)
 *   • vertex normal count + coords (quantized) if the attribute exists
 *   • index count + each index value
 *   • attribute presence flags (so a geometry missing normals
 *     produces a different hash than one with normals, even if the
 *     surviving attributes match)
 *
 * Returns a 16-character lowercase hex string.
 */
export function hashBufferGeometry(geo: THREE.BufferGeometry): string {
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const idx = geo.index;

  // Build a single string buffer then FNV-1a hash it. FNV-1a is
  // chosen for speed + determinism across every JS runtime with
  // no dependency on the Web Crypto API (which needs Promises +
  // worker context in test environments).
  const parts: string[] = [];

  if (pos) {
    parts.push(`P:${pos.count}`);
    for (let i = 0; i < pos.count; i++) {
      parts.push(
        quantize(pos.getX(i)).toString(),
        quantize(pos.getY(i)).toString(),
        quantize(pos.getZ(i)).toString(),
      );
    }
  } else {
    parts.push('P:0');
  }

  if (norm) {
    parts.push(`N:${norm.count}`);
    for (let i = 0; i < norm.count; i++) {
      parts.push(
        quantize(norm.getX(i)).toString(),
        quantize(norm.getY(i)).toString(),
        quantize(norm.getZ(i)).toString(),
      );
    }
  } else {
    parts.push('N:0');
  }

  if (idx) {
    parts.push(`I:${idx.count}`);
    for (let i = 0; i < idx.count; i++) {
      parts.push(idx.getX(i).toString());
    }
  } else {
    parts.push('I:0');
  }

  const serialized = parts.join('|');
  return fnv1a64(serialized);
}

/**
 * 64-bit FNV-1a hash. Implemented as two 32-bit lanes because JS
 * bitwise math tops out at 32 bits. Output is 16 hex chars.
 */
function fnv1a64(input: string): string {
  // FNV offset basis (64-bit): 0xcbf29ce484222325
  // Split as two 32-bit halves: high 0xcbf29ce4, low 0x84222325
  let hashLo = 0x84222325 >>> 0;
  let hashHi = 0xcbf29ce4 >>> 0;
  // FNV prime (64-bit): 0x100000001b3
  // Prime split: high 0x00000001, low 0x000001b3
  const primeLo = 0x000001b3;
  const primeHi = 0x00000001;

  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    // XOR input byte into hash low
    hashLo = (hashLo ^ c) >>> 0;

    // Multiply hash by FNV prime (64-bit), truncating to 64 bits.
    // hash = hash * prime, where each is a 64-bit number split into
    // hi/lo 32-bit halves. Standard schoolbook: produce four
    // 32×32→64 partial products, sum with carries.
    const a = hashLo;
    const b = hashHi;
    const c1 = primeLo;
    const d = primeHi;

    // Split each 32-bit half into two 16-bit halves to keep
    // intermediate products within 32-bit float integer safe range.
    const a0 = a & 0xffff;
    const a1 = a >>> 16;
    const c10 = c1 & 0xffff;
    const c11 = c1 >>> 16;

    const p00 = a0 * c10;          // lo×lo
    const p01 = a0 * c11;          // lo×hi
    const p10 = a1 * c10;          // hi×lo
    const p11 = a1 * c11;          // hi×hi

    // Low 32 bits of a*c1
    const lowCarry = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
    const newLo = ((p00 & 0xffff) + ((lowCarry & 0xffff) << 16)) >>> 0;
    // High 32 bits of a*c1 (ignoring overflow past 64 bits)
    const lowCarryHi = lowCarry >>> 16;
    const acHi = ((p01 >>> 16) + (p10 >>> 16) + p11 + lowCarryHi) >>> 0;

    // Cross terms: a*d and b*c1 contribute to the high lane only.
    const adHi = Math.imul(a, d) >>> 0;
    const bcHi = Math.imul(b, c1) >>> 0;

    const newHi = (acHi + adHi + bcHi) >>> 0;

    hashLo = newLo;
    hashHi = newHi;
  }

  // Format as 16-char hex, big-endian (hi then lo)
  return hashHi.toString(16).padStart(8, '0') + hashLo.toString(16).padStart(8, '0');
}

/**
 * Compact dimensional fingerprint — bounding-box span + vertex count
 * + index count. Orthogonal to `hashBufferGeometry`: catches the
 * case where the hash happens to collide (astronomically unlikely)
 * OR where vertex count matches but the actual dimensions drifted
 * because of a catalog change.
 */
export interface DimensionalFingerprint {
  vertexCount: number;
  indexCount: number;
  /** AABB span on each axis (max - min). Quantized. */
  spanX: number;
  spanY: number;
  spanZ: number;
  /** Total axis-aligned bounding-box volume. Quantized. */
  aabbVolume: number;
}

export function fingerprintBufferGeometry(geo: THREE.BufferGeometry): DimensionalFingerprint {
  const pos = geo.getAttribute('position');
  const idx = geo.index;

  geo.computeBoundingBox();
  const bb = geo.boundingBox;

  const spanX = bb ? quantize(bb.max.x - bb.min.x) : 0;
  const spanY = bb ? quantize(bb.max.y - bb.min.y) : 0;
  const spanZ = bb ? quantize(bb.max.z - bb.min.z) : 0;

  return {
    vertexCount: pos?.count ?? 0,
    indexCount: idx?.count ?? 0,
    spanX,
    spanY,
    spanZ,
    aabbVolume: quantize(spanX * spanY * spanZ),
  };
}

// ── Segment-instance hash (AD.17) ────────────────────────────────

/**
 * Shape of a single instanced segment as produced by `buildPipeEntry`
 * in `segmentExtractCache.ts`. Duplicated here (rather than imported)
 * to keep this module free of a perf-layer dependency.
 */
interface SegmentShape {
  pipeId: string;
  start: THREE.Vector3 | { x: number; y: number; z: number };
  end: THREE.Vector3 | { x: number; y: number; z: number };
  diameter: number;
  material: string;
  opacity: number;
  colorOverride: string | null;
}

/**
 * Phase 14.AD.17 — deterministic fingerprint of a `SegmentInstance[]`
 * list as produced by the fast-mode instanced rendering path
 * (`segmentExtractCache.buildPipeEntry`). Covers every field that
 * feeds into the visible rendering:
 *
 *   • pipeId (instance identity)
 *   • start / end coordinates (quantized to 6 decimals — same rule
 *     as `hashBufferGeometry`)
 *   • diameter + material (bucket classification)
 *   • opacity + colorOverride (floor-ghosting state)
 *
 * Produces a 16-char hex string. Same FNV-1a primitive as the
 * BufferGeometry hash so snapshot files look consistent across
 * AD.13 (3D-mode) and AD.17 (fast-mode) suites.
 *
 * Segment order is preserved — `buildPipeEntry` emits segments in
 * pipe-point order, which is the axial order. If geometry changes
 * flip the order (shouldn't happen, but is a real regression) the
 * hash changes.
 */
export function hashSegmentInstances(segments: readonly SegmentShape[]): string {
  const parts: string[] = [`S:${segments.length}`];
  for (const s of segments) {
    parts.push(
      s.pipeId,
      quantize(s.start.x).toString(),
      quantize(s.start.y).toString(),
      quantize(s.start.z).toString(),
      quantize(s.end.x).toString(),
      quantize(s.end.y).toString(),
      quantize(s.end.z).toString(),
      quantize(s.diameter).toString(),
      s.material,
      quantize(s.opacity).toString(),
      s.colorOverride ?? '',
    );
  }
  return fnv1a64(parts.join('|'));
}

/**
 * Phase 14.AD.17 — compact dimensional fingerprint for a segment
 * list. Orthogonal to the full hash: catches bucket-key drift + gross
 * dimensional shifts without being sensitive to per-vertex rounding.
 */
export interface SegmentListFingerprint {
  segmentCount: number;
  /** Sum of segment lengths, quantized. */
  totalLengthFt: number;
  /** AABB span on each axis across all endpoints. Quantized. */
  spanX: number;
  spanY: number;
  spanZ: number;
  /** Distinct diameter values (sorted ascending). */
  diameters: number[];
  /** Distinct materials (sorted). */
  materials: string[];
  /** True if any segment is ghosted (opacity < 1 or has colorOverride). */
  anyGhosted: boolean;
}

// ── Material property fingerprint (AD.18) ────────────────────────

/**
 * Properties of a `THREE.MeshStandardMaterial` that affect its
 * rendered appearance. Everything else (UUID, version counters,
 * internal uniforms) is excluded because it drifts between THREE.js
 * upgrades without a real visual change.
 *
 * Scoped DOWN from the AD.18 backlog's "pixel-diff layer" plan —
 * shader/texture pixel diffs would bring in headless-gl or similar
 * native deps. This fingerprint catches the common breakage
 * (drifted metalness, wrong color, opacity slipped from 1 to 0.9)
 * without any new runtime dependency. Shader-level regressions fall
 * through this net; they'll need a separate layer if/when we hit one.
 */
export interface MaterialFingerprint {
  color: string;
  emissive: string;
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  side: number;
  depthWrite: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  toneMapped: boolean;
}

/**
 * Shape of a THREE.MeshStandardMaterial field subset. Used here to
 * keep this module free of a hard `three` import for TypeScript's
 * type-resolution — runtime still gets the real THREE.Material.
 */
interface MaterialLike {
  color?: { getHexString: () => string };
  emissive?: { getHexString: () => string };
  metalness?: number;
  roughness?: number;
  emissiveIntensity?: number;
  opacity: number;
  transparent: boolean;
  side: number;
  depthWrite: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  toneMapped: boolean;
}

export function fingerprintMaterial(mat: MaterialLike): MaterialFingerprint {
  return {
    color: `#${mat.color?.getHexString() ?? '000000'}`,
    emissive: `#${mat.emissive?.getHexString() ?? '000000'}`,
    metalness: quantize(mat.metalness ?? 0),
    roughness: quantize(mat.roughness ?? 0),
    emissiveIntensity: quantize(mat.emissiveIntensity ?? 0),
    opacity: quantize(mat.opacity),
    transparent: mat.transparent,
    side: mat.side,
    depthWrite: mat.depthWrite,
    polygonOffset: mat.polygonOffset,
    polygonOffsetFactor: quantize(mat.polygonOffsetFactor),
    polygonOffsetUnits: quantize(mat.polygonOffsetUnits),
    toneMapped: mat.toneMapped,
  };
}

export function hashMaterial(mat: MaterialLike): string {
  const fp = fingerprintMaterial(mat);
  const serialized = [
    fp.color,
    fp.emissive,
    fp.metalness.toString(),
    fp.roughness.toString(),
    fp.emissiveIntensity.toString(),
    fp.opacity.toString(),
    fp.transparent ? '1' : '0',
    fp.side.toString(),
    fp.depthWrite ? '1' : '0',
    fp.polygonOffset ? '1' : '0',
    fp.polygonOffsetFactor.toString(),
    fp.polygonOffsetUnits.toString(),
    fp.toneMapped ? '1' : '0',
  ].join('|');
  return fnv1a64(serialized);
}

export function fingerprintSegmentInstances(
  segments: readonly SegmentShape[],
): SegmentListFingerprint {
  if (segments.length === 0) {
    return {
      segmentCount: 0,
      totalLengthFt: 0,
      spanX: 0,
      spanY: 0,
      spanZ: 0,
      diameters: [],
      materials: [],
      anyGhosted: false,
    };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let totalLen = 0;
  const diameterSet = new Set<number>();
  const materialSet = new Set<string>();
  let anyGhosted = false;
  for (const s of segments) {
    for (const p of [s.start, s.end]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }
    const dx = s.end.x - s.start.x;
    const dy = s.end.y - s.start.y;
    const dz = s.end.z - s.start.z;
    totalLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
    diameterSet.add(s.diameter);
    materialSet.add(s.material);
    if (s.opacity < 1 || s.colorOverride) anyGhosted = true;
  }
  return {
    segmentCount: segments.length,
    totalLengthFt: quantize(totalLen),
    spanX: quantize(maxX - minX),
    spanY: quantize(maxY - minY),
    spanZ: quantize(maxZ - minZ),
    diameters: [...diameterSet].sort((a, b) => a - b),
    materials: [...materialSet].sort(),
    anyGhosted,
  };
}
