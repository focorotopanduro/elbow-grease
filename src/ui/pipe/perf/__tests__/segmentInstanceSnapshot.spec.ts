/**
 * segmentInstance snapshot — Phase 14.AD.17.
 *
 * AD.13 locks the 3D-mode render path (TubeGeometry + merged fitting
 * BufferGeometry) dimensionally. This spec does the equivalent for
 * the fast-mode instanced path, which never produces BufferGeometry
 * — instead it hands `SegmentInstance[]` records to an InstancedMesh
 * and lets the shader draw cylinders with per-instance start/end
 * transforms. AD.7 (3D mode) and AD.8 (fast mode) apply the same
 * retraction logic by design; this spec makes sure those paths stay
 * aligned across any future change.
 *
 * Two fingerprints per fixture:
 *   • Dimensional fingerprint (segment count, total length, AABB
 *     spans, distinct diameters/materials) — human-readable, easy
 *     to review in a diff.
 *   • FNV-1a hash over every field — catches per-coordinate drift
 *     that the fingerprint would miss.
 *
 * Fixtures exercise:
 *   • Straight 2-point rigid pipe (no retraction)
 *   • Straight 2-point with junctionHints start+end retracted
 *   • Multi-bend rigid pipe (internal vertices always retracted)
 *   • Flexible PEX pipe (no retraction regardless of hints)
 *   • Material + diameter bucket variations
 *   • Floor ghosting (opacity < 1)
 *   • Invisible / selected / phase-gated pipes → null entry
 */

import { describe, it, expect } from 'vitest';
import {
  buildPipeEntry,
  type ExtractContext,
  type JunctionHints,
  type SegmentInstance,
} from '../segmentExtractCache';
import type { CommittedPipe } from '@store/pipeStore';
import type { FloorRenderParams } from '@store/floorStore';
import {
  hashSegmentInstances,
  fingerprintSegmentInstances,
} from '../../geometryHash';

// ── Context helpers ───────────────────────────────────────────

const ALL_VISIBLE: ExtractContext['systemVisibility'] = {
  cold_supply: true,
  hot_supply: true,
  waste: true,
  vent: true,
  storm: true,
  condensate: true,
};

const FULL_FLOOR: (yMin: number, yMax: number) => FloorRenderParams =
  () => ({ visible: true, opacity: 1, colorOverride: null, disableInteraction: false });

const GHOSTED_FLOOR: (yMin: number, yMax: number) => FloorRenderParams =
  () => ({ visible: true, opacity: 0.35, colorOverride: '#888888', disableInteraction: true });

const PHASE_ALL: ExtractContext['phaseFilter'] = {
  activePhase: 'rough_in',
  mode: 'all',
  pipeOverride: () => undefined,
};

function baseCtx(
  overrides: Partial<ExtractContext> = {},
): ExtractContext {
  return {
    systemVisibility: ALL_VISIBLE,
    getFloorParams: FULL_FLOOR,
    phaseFilter: PHASE_ALL,
    ...overrides,
  };
}

function mkPipe(
  id: string,
  points: [number, number, number][],
  overrides: Partial<CommittedPipe> = {},
): CommittedPipe {
  return {
    id,
    points,
    diameter: 2,
    material: 'pvc_sch40',
    system: 'cold_supply',
    color: '#ffa726',
    visible: true,
    selected: false,
    ...overrides,
  };
}

function mkHints(
  entries: ReadonlyArray<[string, { retractStartFt: number; retractEndFt: number }]>,
): JunctionHints {
  return new Map(entries);
}

/** Extract segments for a single pipe; null result asserts up-front. */
function segsFor(
  pipe: CommittedPipe,
  ctx: ExtractContext,
): SegmentInstance[] {
  const entry = buildPipeEntry(pipe, ctx);
  if (!entry) throw new Error(`buildPipeEntry returned null for ${pipe.id}`);
  return entry.segments;
}

// ── Fixtures — straight rigid, no retraction ─────────────────

describe('AD.17 fast-mode snapshots — straight rigid pipes', () => {
  it('2" PVC Sch 40 straight, no hints: identity pipe geometry', () => {
    const pipe = mkPipe('s1', [[0, 5, 0], [10, 5, 0]]);
    const segs = segsFor(pipe, baseCtx());
    expect(segs).toHaveLength(1);
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });

  it('2" PVC Sch 40 straight, start+end hints → both endpoints retracted', () => {
    const pipe = mkPipe('s2', [[0, 5, 0], [10, 5, 0]]);
    const hints = mkHints([['s2', { retractStartFt: 0.422, retractEndFt: 0.422 }]]);
    const segs = segsFor(pipe, baseCtx({ junctionHints: hints }));
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });

  it('2" PVC Sch 40 straight, only start hint → only head retracted', () => {
    const pipe = mkPipe('s3', [[0, 5, 0], [10, 5, 0]]);
    const hints = mkHints([['s3', { retractStartFt: 0.422, retractEndFt: 0 }]]);
    const segs = segsFor(pipe, baseCtx({ junctionHints: hints }));
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });
});

describe('AD.17 fast-mode snapshots — multi-segment rigid pipes', () => {
  it('3-point L-bend 90° pvc_sch40 2": interior vertex always retracted', () => {
    const pipe = mkPipe('m1', [[0, 5, 0], [10, 5, 0], [10, 5, 10]]);
    const segs = segsFor(pipe, baseCtx());
    expect(segs).toHaveLength(2);
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });

  it('4-point U-bend pvc_sch40 2": three interior vertices all retracted', () => {
    const pipe = mkPipe('m2', [
      [0, 5, 0], [10, 5, 0], [10, 5, 10], [0, 5, 10],
    ]);
    const segs = segsFor(pipe, baseCtx());
    expect(segs).toHaveLength(3);
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });

  it('3-point vertical drop pvc_sch40 3": interior vertex retracted at deeper socket', () => {
    const pipe = mkPipe('m3', [[0, 5, 0], [10, 5, 0], [10, 0, 0]], {
      diameter: 3,
    });
    const segs = segsFor(pipe, baseCtx());
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });
});

// ── Material bucket coverage ─────────────────────────────────

describe('AD.17 fast-mode snapshots — material buckets', () => {
  const MATERIALS: Array<CommittedPipe['material']> = [
    'pvc_sch40', 'pvc_sch80', 'abs', 'cpvc',
    'copper_type_l', 'copper_type_m',
    'cast_iron', 'ductile_iron', 'galvanized_steel',
  ];

  for (const mat of MATERIALS) {
    it(`2" straight ${mat} with both-end retract`, () => {
      const pipe = mkPipe(`mat-${mat}`, [[0, 5, 0], [10, 5, 0]], {
        material: mat,
      });
      const hints = mkHints([[`mat-${mat}`, { retractStartFt: 0.422, retractEndFt: 0.422 }]]);
      const segs = segsFor(pipe, baseCtx({ junctionHints: hints }));
      expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
      expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
    });
  }

  it('PEX is flexible: retraction hints are IGNORED even at both ends', () => {
    // AD.8 contract: flexible materials skip retraction regardless
    // of junctionHints. The snapshot should match the "no-retract"
    // fingerprint for a pvc straight of the same shape.
    const pipe = mkPipe('pex1', [[0, 5, 0], [10, 5, 0]], {
      material: 'pex',
      diameter: 1,
    });
    const hints = mkHints([['pex1', { retractStartFt: 0.422, retractEndFt: 0.422 }]]);
    const segs = segsFor(pipe, baseCtx({ junctionHints: hints }));
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });
});

// ── Diameter bucket coverage ─────────────────────────────────

describe('AD.17 fast-mode snapshots — diameter scale', () => {
  const DIAMETERS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];
  for (const d of DIAMETERS) {
    it(`${d}" pvc_sch40 straight, retracted both ends`, () => {
      const pipe = mkPipe(`d-${d}`, [[0, 5, 0], [10, 5, 0]], {
        diameter: d,
      });
      const hints = mkHints([[`d-${d}`, { retractStartFt: 0.422, retractEndFt: 0.422 }]]);
      const segs = segsFor(pipe, baseCtx({ junctionHints: hints }));
      expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
      expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
    });
  }
});

// ── Floor ghosting path ──────────────────────────────────────

describe('AD.17 fast-mode snapshots — floor ghosting carries through', () => {
  it('ghosted floor → segments inherit opacity + colorOverride', () => {
    const pipe = mkPipe('g1', [[0, 5, 0], [10, 5, 0]]);
    const segs = segsFor(pipe, baseCtx({ getFloorParams: GHOSTED_FLOOR }));
    // Sanity: ghosting really landed on the segment
    expect(segs[0]!.opacity).toBeCloseTo(0.35, 3);
    expect(segs[0]!.colorOverride).toBe('#888888');
    expect(fingerprintSegmentInstances(segs)).toMatchSnapshot('fp');
    expect(hashSegmentInstances(segs)).toMatchSnapshot('hash');
  });
});

// ── Gated-out cases (null entry) ─────────────────────────────

describe('AD.17 fast-mode — gated-out pipes return null (no segments)', () => {
  it('invisible pipe → null', () => {
    const pipe = mkPipe('inv', [[0, 5, 0], [10, 5, 0]], { visible: false });
    expect(buildPipeEntry(pipe, baseCtx())).toBeNull();
  });

  it('selected pipe → null (renders via separate highlight layer)', () => {
    const pipe = mkPipe('sel', [[0, 5, 0], [10, 5, 0]], { selected: true });
    expect(buildPipeEntry(pipe, baseCtx())).toBeNull();
  });

  it('system gated off → null', () => {
    const pipe = mkPipe('gate', [[0, 5, 0], [10, 5, 0]], { system: 'waste' });
    const ctx = baseCtx({
      systemVisibility: { ...ALL_VISIBLE, waste: false },
    });
    expect(buildPipeEntry(pipe, ctx)).toBeNull();
  });
});
