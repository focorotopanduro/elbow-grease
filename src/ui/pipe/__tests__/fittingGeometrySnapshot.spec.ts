/**
 * Fitting geometry snapshot harness — Phase 14.AD.13.c
 *
 * Locks the geometric OUTPUT of every `FittingType` × representative
 * (material, diameter) combination. Any change to a fitting
 * builder — new hub shape, different torus tube segments, retuned
 * bend radius — flips at least one snapshot.
 *
 * Coverage: 23 fitting types × 3 diameters × 3 materials + some
 * transition (reducer/bushing) combos = ~220 snapshots. Larger than
 * the pipe matrix but still runs under 2s in CI.
 *
 * Update workflow:
 *
 *   npx vitest run src/ui/pipe/__tests__/fittingGeometrySnapshot.spec.ts -u
 *
 *   Inspect the snapshot diff. An intentional change to a single
 *   builder should produce snapshot changes scoped to the rows that
 *   reference that type — if unrelated rows flip, investigate.
 */

import { describe, it, expect } from 'vitest';
import { getFittingGeometryByType } from '../FittingMeshes';
import { hashBufferGeometry, fingerprintBufferGeometry } from '../geometryHash';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';
import { FITTING_TYPES } from '../../../engine/graph/GraphEdge';

// ── Matrix setup ─────────────────────────────────────────────

// Materials chosen to cover the three hub-decoration families:
//   PVC → primer ring, moderate hub oversize (1.16×)
//   Copper → solder bead, tight hub (1.04×)
//   PEX → crimp ring, gentle oversize (1.12×)
// Cast iron (dramatic oversize 1.30×) is excluded from the big
// matrix for brevity; spot-checked separately below.
const PRIMARY_MATERIALS: PipeMaterial[] = [
  'pvc_sch40',
  'copper_type_l',
  'pex',
];

const DIAMETERS = [1.5, 2, 3];

// Fitting types that are valid at all the primary diameters.
const GENERAL_TYPES: string[] = [
  'bend_22_5',
  'bend_45',
  'elbow_45',
  'bend_90',
  'elbow_90',
  'bend_90_ls',
  'tee',
  'sanitary_tee',
  'wye',
  'combo_wye_eighth',
  'cross',
  'coupling',
  'cap',
  'cleanout_adapter',
  'closet_flange',
  'p_trap',
];

const PEX_ONLY_TYPES: string[] = ['pex_elbow_90'];

const MANIFOLD_TYPES: string[] = ['manifold_2', 'manifold_4', 'manifold_6', 'manifold_8'];

// ── General fitting matrix ──────────────────────────────────

describe('getFittingGeometryByType — general fittings × materials × diameters', () => {
  for (const type of GENERAL_TYPES) {
    for (const material of PRIMARY_MATERIALS) {
      for (const diameter of DIAMETERS) {
        it(`${type} · ${material} · ${diameter}"`, () => {
          const g = getFittingGeometryByType(type, material, diameter);
          expect({
            hash: hashBufferGeometry(g),
            dim: fingerprintBufferGeometry(g),
          }).toMatchSnapshot();
        });
      }
    }
  }
});

// ── Reducers (two-diameter) ─────────────────────────────────

describe('getFittingGeometryByType — reducers', () => {
  const pairs: Array<[number, number]> = [
    [3, 2],
    [2, 1.5],
    [1.5, 1],
  ];
  for (const [big, small] of pairs) {
    for (const material of ['pvc_sch40', 'copper_type_l'] as PipeMaterial[]) {
      it(`reducer · ${material} · ${big}"→${small}"`, () => {
        const g = getFittingGeometryByType('reducer', material, big, small);
        expect({
          hash: hashBufferGeometry(g),
          dim: fingerprintBufferGeometry(g),
        }).toMatchSnapshot();
      });
    }
  }
});

// ── Bushings (AD.12) ─────────────────────────────────────────

describe('getFittingGeometryByType — bushings', () => {
  const pairs: Array<[number, number]> = [
    [3, 2],
    [2, 1.5],
    [2, 1],
  ];
  for (const [big, small] of pairs) {
    it(`bushing · pvc_sch40 · ${big}"→${small}"`, () => {
      const g = getFittingGeometryByType('bushing', 'pvc_sch40', big, small);
      expect({
        hash: hashBufferGeometry(g),
        dim: fingerprintBufferGeometry(g),
      }).toMatchSnapshot();
    });
  }
});

// ── PEX-specific ─────────────────────────────────────────────

describe('getFittingGeometryByType — PEX-specific', () => {
  for (const type of PEX_ONLY_TYPES) {
    for (const diameter of [0.75, 1, 1.5]) {
      it(`${type} · pex · ${diameter}"`, () => {
        const g = getFittingGeometryByType(type, 'pex', diameter);
        expect({
          hash: hashBufferGeometry(g),
          dim: fingerprintBufferGeometry(g),
        }).toMatchSnapshot();
      });
    }
  }
});

// ── Manifolds (PEX home-run supply) ─────────────────────────

describe('getFittingGeometryByType — manifolds', () => {
  for (const type of MANIFOLD_TYPES) {
    it(`${type} · pex · 1"`, () => {
      const g = getFittingGeometryByType(type, 'pex', 1);
      expect({
        hash: hashBufferGeometry(g),
        dim: fingerprintBufferGeometry(g),
      }).toMatchSnapshot();
    });
  }
});

// ── Cast iron spot check ─────────────────────────────────────

describe('getFittingGeometryByType — cast iron spot check', () => {
  // Cast iron has the most dramatic hub oversize (1.30×). Worth
  // snapshotting a few key fittings separately to catch hub-sizing
  // regressions that might not show up with tighter-hub materials.
  for (const type of ['bend_45', 'bend_90', 'sanitary_tee', 'wye', 'p_trap'] as const) {
    for (const diameter of [3, 4]) {
      it(`${type} · cast_iron · ${diameter}"`, () => {
        const g = getFittingGeometryByType(type, 'cast_iron', diameter);
        expect({
          hash: hashBufferGeometry(g),
          dim: fingerprintBufferGeometry(g),
        }).toMatchSnapshot();
      });
    }
  }
});

// ── Unknown type falls through to elbow (regression guard) ──

describe('getFittingGeometryByType — unknown-type fallback', () => {
  it('unknown type falls through to getElbow90Geo', () => {
    const fallback = getFittingGeometryByType('unknown-type-not-in-catalog', 'pvc_sch40', 2);
    const elbow90 = getFittingGeometryByType('bend_90', 'pvc_sch40', 2);
    expect(hashBufferGeometry(fallback)).toBe(hashBufferGeometry(elbow90));
  });
});

// ── Coverage contract ────────────────────────────────────────

describe('getFittingGeometryByType — coverage contract', () => {
  it('every FittingType in the catalog has a dispatch case', () => {
    // Regression guard: if someone adds a type to FITTING_TYPES but
    // forgets to add a dispatch case, this test spots it — the
    // unknown type falls through to elbow, which would make its
    // hash identical to bend_90. We assert the opposite.
    const elbow90Hash = hashBufferGeometry(getFittingGeometryByType('bend_90', 'pvc_sch40', 2));
    const missing: string[] = [];
    for (const type of FITTING_TYPES) {
      // Reducer + bushing need diameter2; skip (tested separately above).
      if (type === 'reducer' || type === 'bushing') continue;
      const h = hashBufferGeometry(getFittingGeometryByType(type, 'pvc_sch40', 2));
      if (type !== 'bend_90' && type !== 'elbow_90' && h === elbow90Hash) {
        missing.push(type);
      }
    }
    expect(missing).toEqual([]);
  });
});
