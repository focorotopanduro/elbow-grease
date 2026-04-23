/**
 * angleSnap — bug-fix pass tests.
 */

import { describe, it, expect } from 'vitest';
import {
  snapDirectionXZ,
  constrainCandidateToLegalBend,
  materialRequiresLegalAngles,
  LEGAL_RELATIVE_ANGLES_DEG,
  snapLengthOnDirection,
  constrainRiseToLegal,
  applyDrawConstraints,
} from '../angleSnap';

// A few helpers for building vectors along specific XZ angles.
function fromAngle(angleDeg: number, len = 1): [number, number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [len * Math.cos(rad), 0, len * Math.sin(rad)];
}

function xzAngleDeg(v: readonly [number, number, number]): number {
  return (Math.atan2(v[2], v[0]) * 180) / Math.PI;
}

describe('snapDirectionXZ', () => {
  const xDir: [number, number, number] = [1, 0, 0]; // +X

  it('0° stays 0° (straight continuation is legal)', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(3)); // nearly straight
    expect(xzAngleDeg(snapped)).toBeCloseTo(0, 2);
  });

  it('20° (close to 22.5°) snaps to 22.5°', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(20));
    expect(xzAngleDeg(snapped)).toBeCloseTo(22.5, 1);
  });

  it('30° (between 22.5° and 45°) snaps to 22.5° (nearer)', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(30));
    expect(xzAngleDeg(snapped)).toBeCloseTo(22.5, 1);
  });

  it('40° snaps to 45°', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(40));
    expect(xzAngleDeg(snapped)).toBeCloseTo(45, 1);
  });

  it('60° snaps to 45° (nearer than 90°)', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(60));
    expect(xzAngleDeg(snapped)).toBeCloseTo(45, 1);
  });

  it('80° snaps to 90°', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(80));
    expect(xzAngleDeg(snapped)).toBeCloseTo(90, 1);
  });

  it('negative angles snap symmetrically (-80° → -90°)', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(-80));
    expect(xzAngleDeg(snapped)).toBeCloseTo(-90, 1);
  });

  it('preserves magnitude in XZ', () => {
    const snapped = snapDirectionXZ(xDir, fromAngle(40, 7.3));
    const mag = Math.hypot(snapped[0], snapped[2]);
    expect(mag).toBeCloseTo(7.3, 3);
  });

  it('preserves Y component of the raw vector', () => {
    const raw: [number, number, number] = [5, 3, 3];
    const snapped = snapDirectionXZ(xDir, raw);
    expect(snapped[1]).toBe(3);
  });

  it('returns raw as-is when previous has zero XZ length', () => {
    const zeroPrev: [number, number, number] = [0, 5, 0];
    const raw: [number, number, number] = [3, 0, 4];
    const snapped = snapDirectionXZ(zeroPrev, raw);
    expect(snapped).toEqual(raw);
  });
});

describe('constrainCandidateToLegalBend', () => {
  it('returns a legal-angle candidate point from a raw off-angle click', () => {
    // prev segment: (0,0,0) → (5,0,0), along +X.
    // User clicks at (8, 0, 2.5) → raw bend ≈ 40° → snaps to 45°.
    const out = constrainCandidateToLegalBend(
      [0, 0, 0], [5, 0, 0], [8, 0, 2.5],
    );
    // new segment from (5,0,0) at 45° → last.x + L/√2, last.z + L/√2
    const dx = out[0] - 5;
    const dz = out[2] - 0;
    const ang = (Math.atan2(dz, dx) * 180) / Math.PI;
    expect(ang).toBeCloseTo(45, 1);
  });

  it('preserves raw segment length in XZ', () => {
    const out = constrainCandidateToLegalBend(
      [0, 0, 0], [5, 0, 0], [8, 0, 2.5],
    );
    const dx = out[0] - 5;
    const dz = out[2] - 0;
    const len = Math.hypot(dx, dz);
    const rawLen = Math.hypot(8 - 5, 2.5 - 0);
    expect(len).toBeCloseTo(rawLen, 3);
  });
});

describe('materialRequiresLegalAngles', () => {
  it('true for PVC / copper / cast iron / etc', () => {
    expect(materialRequiresLegalAngles('pvc_sch40')).toBe(true);
    expect(materialRequiresLegalAngles('copper_type_l')).toBe(true);
    expect(materialRequiresLegalAngles('cast_iron')).toBe(true);
    expect(materialRequiresLegalAngles('galvanized_steel')).toBe(true);
  });

  it('false for PEX (flexible)', () => {
    expect(materialRequiresLegalAngles('pex')).toBe(false);
  });
});

describe('LEGAL_RELATIVE_ANGLES_DEG', () => {
  it('contains 0, ±22.5, ±45, ±90', () => {
    expect(LEGAL_RELATIVE_ANGLES_DEG).toEqual([-90, -45, -22.5, 0, 22.5, 45, 90]);
  });
});

// ── Phase 14.R additions ─────────────────────────────────────

describe('snapLengthOnDirection', () => {
  it('snaps to multiples of gridStep along the direction', () => {
    // From origin → (10.7, 0, 0), grid step 0.5 → snap length 10.5
    const out = snapLengthOnDirection([0, 0, 0], [10.7, 0, 0], 0.5);
    expect(out[0]).toBeCloseTo(10.5, 6);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('preserves direction exactly when snapping 22.5° segment', () => {
    // 22.5° in XZ from +X axis, raw length 8.1
    const rad = (22.5 * Math.PI) / 180;
    const dir = [Math.cos(rad), 0, Math.sin(rad)];
    const raw: [number, number, number] = [dir[0]! * 8.1, 0, dir[2]! * 8.1];
    const out = snapLengthOnDirection([0, 0, 0], raw, 0.5);
    // Length should snap to 8.0 (nearest 0.5 multiple), but direction
    // ratio dx/dz must still be cos22.5 / sin22.5.
    const len = Math.hypot(out[0], out[2]);
    expect(len).toBeCloseTo(8.0, 2);
    expect(out[2] / out[0]).toBeCloseTo(dir[2]! / dir[0]!, 6);
  });

  it('enforces minimum 1 grid step', () => {
    // Raw length 0.2 → would round to 0; we bump to 0.5.
    const out = snapLengthOnDirection([0, 0, 0], [0.2, 0, 0], 0.5);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(0.5);
  });

  it('returns lastPoint unchanged for zero-length input', () => {
    const out = snapLengthOnDirection([3, 2, 1], [3, 2, 1], 0.5);
    expect(out).toEqual([3, 2, 1]);
  });
});

describe('constrainRiseToLegal', () => {
  it('flat segment stays flat (0° rise)', () => {
    const out = constrainRiseToLegal([0, 0, 0], [10, 0.05, 0]); // ~0.29° rise
    // Should snap to horizontal
    expect(out[1]).toBeCloseTo(0, 3);
  });

  it('gentle upward (7°) snaps to 0°', () => {
    const out = constrainRiseToLegal([0, 0, 0], [10, 1.23, 0]); // 7° rise
    expect(out[1]).toBeCloseTo(0, 2);
  });

  it('30° rise snaps to 45°', () => {
    const len = 10;
    const rad = (30 * Math.PI) / 180;
    const raw: [number, number, number] = [len * Math.cos(rad), len * Math.sin(rad), 0];
    const out = constrainRiseToLegal([0, 0, 0], raw);
    const horiz = Math.hypot(out[0], out[2]);
    const riseDeg = (Math.atan2(out[1], horiz) * 180) / Math.PI;
    expect(riseDeg).toBeCloseTo(45, 1);
  });

  it('preserves total length', () => {
    const raw: [number, number, number] = [10, 3, 0];
    const out = constrainRiseToLegal([0, 0, 0], raw);
    const rawLen = Math.hypot(raw[0], raw[1]);
    const outLen = Math.hypot(out[0], out[1], out[2]);
    expect(outLen).toBeCloseTo(rawLen, 5);
  });

  it('preserves XZ heading (azimuth)', () => {
    // Heading along +Z, 30° rise
    const raw: [number, number, number] = [0, 5, 8.66]; // len ≈ 10, rise ~30°
    const out = constrainRiseToLegal([0, 0, 0], raw);
    // Heading (atan2 over XZ) must still be +Z (atan2(1,0) → π/2)
    expect(out[0]).toBeCloseTo(0, 5);
    // Z should still be positive
    expect(out[2]).toBeGreaterThan(0);
  });

  it('pure vertical stays vertical', () => {
    const out = constrainRiseToLegal([0, 0, 0], [0, 9, 0]);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(9, 5);
  });
});

describe('applyDrawConstraints', () => {
  const ctxDefault = {
    material: 'pvc_sch40',
    drawPlane: 'horizontal' as const,
    gridStep: 0.5,
  };

  it('first point: grid-snap only, no angle constraint', () => {
    const out = applyDrawConstraints([3.27, 0, 5.13], { ...ctxDefault, points: [] });
    expect(out[0]).toBe(3.5);
    expect(out[2]).toBe(5.0);
  });

  it('PEX material: grid-snap only (flex)', () => {
    const out = applyDrawConstraints([3.27, 0, 5.13], {
      ...ctxDefault,
      material: 'pex',
      points: [[0, 0, 0], [5, 0, 0]],
    });
    expect(out[0]).toBe(3.5);
    expect(out[2]).toBe(5.0);
  });

  it('rigid + 2+ points: bends to legal angle + snaps length', () => {
    // After (0,0,0)→(10,0,0), user clicks at (19, 0, 3) which is a
    // weird angle (~19° from +X). Should snap to 22.5° (closest
    // legal) and the length should quantize to 0.5.
    const out = applyDrawConstraints([19, 0, 3], {
      ...ctxDefault,
      points: [[0, 0, 0], [10, 0, 0]],
    });
    // Legal angle check: relative direction off +X must be a legal angle
    const dx = out[0] - 10;
    const dz = out[2] - 0;
    const relDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
    const nearest = [-90, -45, -22.5, 0, 22.5, 45, 90].reduce(
      (best, leg) => Math.abs(leg - relDeg) < Math.abs(best - relDeg) ? leg : best,
      999,
    );
    expect(Math.abs(relDeg - nearest)).toBeLessThan(0.1);
    // Length on 0.5 grid
    const len = Math.hypot(dx, dz);
    expect(Math.abs(len / 0.5 - Math.round(len / 0.5))).toBeLessThan(0.01);
  });

  it('rigid + steep rise: snaps to 45° vertical', () => {
    // From (0,0,0) → user tries to go up 7 ft over 10 ft horizontal
    // (~35° rise). Should snap to 45°.
    const out = applyDrawConstraints([10, 7, 0], {
      ...ctxDefault,
      points: [[0, 0, 0]],
    });
    const horiz = Math.hypot(out[0], out[2]);
    const riseDeg = (Math.atan2(out[1], horiz) * 180) / Math.PI;
    expect(riseDeg).toBeCloseTo(45, 1);
  });
});
