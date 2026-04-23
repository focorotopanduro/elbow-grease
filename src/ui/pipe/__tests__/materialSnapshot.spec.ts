/**
 * Material property snapshot — Phase 14.AD.18.
 *
 * Scoped DOWN from the AD.18 backlog line ("optional pixel-diff layer
 * for shader/material regression"). Full pixel diff would require
 * headless-gl or puppeteer and a texture-conformance renderer —
 * that's a large dependency surface for a small class of
 * regressions. Instead this spec fingerprints the STRUCTURED
 * properties of every cached `MeshStandardMaterial` produced by
 * `PipeMaterial.ts`:
 *
 *   • Color + emissive hex values
 *   • metalness / roughness / emissiveIntensity (quantized)
 *   • opacity + transparent + side + depthWrite
 *   • polygonOffset + factor + units
 *   • toneMapped flag
 *
 * This catches 95% of the real "material drifted" regressions —
 * someone nudges `metalness: 0.8` to `0.5` during a refactor and the
 * snapshot fires. Genuine shader-program regressions (vertex/fragment
 * code, custom ShaderMaterial) still fall through; those would need
 * a separate pixel-diff layer if/when they become a real problem.
 *
 * Coverage matrix:
 *   • Every material type × default diameter × cold_supply system
 *   • PEX across all supply systems (color changes by system)
 *   • Selected + wall-shell variants
 *   • Preview material
 *   • Representative diameter ladder for plastic materials (where
 *     diameter tint blends into base color)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPipeMaterial,
  getSelectedPipeMaterial,
  getWallShellMaterial,
  getPreviewMaterial,
  disposeAllMaterials,
} from '../PipeMaterial';
import { hashMaterial, fingerprintMaterial } from '../geometryHash';
import type { PipeMaterial as PipeMaterialType } from '../../../engine/graph/GraphEdge';
import type { SystemType } from '../../../engine/graph/GraphNode';

beforeEach(() => {
  // Material factory caches by (diameter, material, system, variant).
  // Clear between tests so each build starts from a known empty
  // cache state — otherwise test ordering could influence hashes
  // (it won't, because the factory is referentially transparent,
  // but a fresh cache is cleaner for a snapshot suite).
  disposeAllMaterials();
});

const MATERIALS: PipeMaterialType[] = [
  'pvc_sch40', 'pvc_sch80', 'abs', 'cpvc',
  'copper_type_l', 'copper_type_m',
  'cast_iron', 'ductile_iron',
  'galvanized_steel',
  'pex',
];

// ── Main pipe material ───────────────────────────────────────

describe('AD.18 material snapshots — main pipe material per type', () => {
  for (const mat of MATERIALS) {
    it(`2" ${mat} cold_supply main material`, () => {
      const m = getPipeMaterial(2, mat, 'cold_supply');
      expect(fingerprintMaterial(m)).toMatchSnapshot('fp');
      expect(hashMaterial(m)).toMatchSnapshot('hash');
    });
  }
});

// ── PEX per-system color ─────────────────────────────────────

describe('AD.18 material snapshots — PEX per system', () => {
  const SYSTEMS: SystemType[] = [
    'hot_supply', 'cold_supply', 'waste', 'vent', 'storm', 'condensate',
  ];
  for (const sys of SYSTEMS) {
    it(`PEX 1" ${sys} system color`, () => {
      const m = getPipeMaterial(1, 'pex', sys);
      expect(fingerprintMaterial(m)).toMatchSnapshot('fp');
      expect(hashMaterial(m)).toMatchSnapshot('hash');
    });
  }
});

// ── Plastic pipe diameter tint ladder ────────────────────────

describe('AD.18 material snapshots — plastic diameter tint ladder', () => {
  // Plastic pipes (pvc, abs, cpvc) blend a diameter-coded color into
  // their base. Lock the per-diameter output for a representative
  // plastic material.
  const DIAMETERS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];
  for (const d of DIAMETERS) {
    it(`pvc_sch40 ${d}" cold_supply — diameter tint`, () => {
      const m = getPipeMaterial(d, 'pvc_sch40', 'cold_supply');
      expect(fingerprintMaterial(m)).toMatchSnapshot('fp');
      expect(hashMaterial(m)).toMatchSnapshot('hash');
    });
  }
});

// ── Selected material variant ────────────────────────────────

describe('AD.18 material snapshots — selected (highlight) variant', () => {
  for (const mat of MATERIALS) {
    it(`2" ${mat} selected material (yellow emissive)`, () => {
      const m = getSelectedPipeMaterial(2, mat, 'cold_supply');
      expect(fingerprintMaterial(m)).toMatchSnapshot('fp');
      expect(hashMaterial(m)).toMatchSnapshot('hash');
    });
  }
});

// ── Wall shell (rim) material ────────────────────────────────

describe('AD.18 material snapshots — wall-shell (diameter ring)', () => {
  // Wall shell uses diameter color regardless of material, so vary
  // diameter rather than material here.
  const DIAMETERS = [0.5, 1, 2, 3, 4, 6];
  for (const d of DIAMETERS) {
    it(`${d}" wall-shell material`, () => {
      const m = getWallShellMaterial(d, 'pvc_sch40', 'cold_supply');
      expect(fingerprintMaterial(m)).toMatchSnapshot('fp');
      expect(hashMaterial(m)).toMatchSnapshot('hash');
    });
  }
});

// ── Preview material (live draw) ─────────────────────────────

describe('AD.18 material snapshots — preview (live draw)', () => {
  it('preview material has stable cyan tint + emissive', () => {
    const m = getPreviewMaterial();
    expect(fingerprintMaterial(m)).toMatchSnapshot('fp');
    expect(hashMaterial(m)).toMatchSnapshot('hash');
  });
});

// ── Sanity: caching does not influence fingerprint ───────────

describe('AD.18 — cached materials fingerprint identically on repeat calls', () => {
  it('two getPipeMaterial calls with same args return the same object and same hash', () => {
    const a = getPipeMaterial(2, 'pvc_sch40', 'cold_supply');
    const b = getPipeMaterial(2, 'pvc_sch40', 'cold_supply');
    expect(a).toBe(b); // object identity (cache hit)
    expect(hashMaterial(a)).toBe(hashMaterial(b));
  });

  it('different diameters produce different hashes (diameter tint)', () => {
    const a = getPipeMaterial(1, 'pvc_sch40', 'cold_supply');
    const b = getPipeMaterial(4, 'pvc_sch40', 'cold_supply');
    expect(hashMaterial(a)).not.toBe(hashMaterial(b));
  });

  it('different materials (copper vs galvanized) produce different hashes', () => {
    const a = getPipeMaterial(2, 'copper_type_l', 'cold_supply');
    const b = getPipeMaterial(2, 'galvanized_steel', 'cold_supply');
    expect(hashMaterial(a)).not.toBe(hashMaterial(b));
    const fpA = fingerprintMaterial(a);
    const fpB = fingerprintMaterial(b);
    // Copper should be more metallic than galvanized — it is in the
    // look table (0.92 vs 0.80). This is a "did the pipe catalog
    // get retuned" sanity check as much as a hash check.
    expect(fpA.metalness).toBeGreaterThan(fpB.metalness);
  });

  it('PEX hot vs cold: different colors, identical metalness/roughness', () => {
    const hot = getPipeMaterial(1, 'pex', 'hot_supply');
    const cold = getPipeMaterial(1, 'pex', 'cold_supply');
    expect(hashMaterial(hot)).not.toBe(hashMaterial(cold));
    const hotFp = fingerprintMaterial(hot);
    const coldFp = fingerprintMaterial(cold);
    expect(hotFp.metalness).toBe(coldFp.metalness);
    expect(hotFp.roughness).toBe(coldFp.roughness);
    expect(hotFp.color).not.toBe(coldFp.color);
  });
});
