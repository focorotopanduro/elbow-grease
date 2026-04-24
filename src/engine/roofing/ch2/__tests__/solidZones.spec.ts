/**
 * ALG-011 — `solid_zones_for_spaced_roof` tests.
 *
 * Covers the implicit edge-case table from spec §6 ALG-011 plus
 * the override-validation behaviour new to this port.
 */

import { describe, it, expect } from 'vitest';
import { solid_zones_for_spaced_roof } from '../algorithms/solidZones';
import { InvalidGeometry, SheathingSpecViolation } from '../errors';
import {
  EAVE_PROTECTION_MIN_IN,
  EAVE_SOLID_DEFAULT_IN,
  EAVE_SOLID_LOW_SLOPE_IN,
  RIDGE_SOLID_EACH_SIDE_IN,
} from '../constants';

describe('ALG-011 solid_zones_for_spaced_roof — spec §6 ALG-011 cases', () => {
  // Normal slope, open cornice, default override
  it('slope 6:12, open cornice → eave 18", gable solid', () => {
    const zones = solid_zones_for_spaced_roof(6, true);
    expect(zones.eave_solid_in).toBe(EAVE_SOLID_DEFAULT_IN);
    expect(zones.ridge_solid_each_side_in).toBe(RIDGE_SOLID_EACH_SIDE_IN);
    expect(zones.gable_overhang_solid).toBe(true);
    expect(zones.eave_protection_membrane_min_in).toBe(EAVE_PROTECTION_MIN_IN);
  });

  // Normal slope, closed cornice
  it('slope 6:12, closed cornice → eave 18", gable NOT solid', () => {
    const zones = solid_zones_for_spaced_roof(6, false);
    expect(zones.eave_solid_in).toBe(EAVE_SOLID_DEFAULT_IN);
    expect(zones.gable_overhang_solid).toBe(false);
  });

  // Normal slope with in-range override
  it('slope 6:12, override 22 → eave 22"', () => {
    const zones = solid_zones_for_spaced_roof(6, false, 22);
    expect(zones.eave_solid_in).toBe(22);
  });

  // Normal slope with override at lower bound (boundary inclusive)
  it('slope 6:12, override at min (12) → eave 12"', () => {
    const zones = solid_zones_for_spaced_roof(6, false, 12);
    expect(zones.eave_solid_in).toBe(12);
  });

  // Normal slope with override at upper bound (boundary inclusive)
  it('slope 6:12, override at max (24) → eave 24"', () => {
    const zones = solid_zones_for_spaced_roof(6, false, 24);
    expect(zones.eave_solid_in).toBe(24);
  });
});

describe('ALG-011 — low-slope 36" physics rule', () => {
  // Low slope forces 36" regardless of override
  it('slope 3.99:12, no override → eave 36" (low-slope rule)', () => {
    const zones = solid_zones_for_spaced_roof(3.99, false);
    expect(zones.eave_solid_in).toBe(EAVE_SOLID_LOW_SLOPE_IN);
  });

  it('slope 3.99:12 with override 22 → eave 36" (override ignored)', () => {
    const zones = solid_zones_for_spaced_roof(3.99, false, 22);
    expect(zones.eave_solid_in).toBe(EAVE_SOLID_LOW_SLOPE_IN);
  });

  it('slope 0:12 → eave 36" (extreme low still hits low-slope rule)', () => {
    const zones = solid_zones_for_spaced_roof(0, false);
    expect(zones.eave_solid_in).toBe(EAVE_SOLID_LOW_SLOPE_IN);
  });

  // The exclusive boundary at 4:12 — slope = 4 is NORMAL slope
  it('slope 4:12 (boundary) → eave uses default 18 (NOT low-slope path)', () => {
    const zones = solid_zones_for_spaced_roof(4, false);
    expect(zones.eave_solid_in).toBe(EAVE_SOLID_DEFAULT_IN);
  });

  it('slope 4:12 with override 22 → eave 22 (override honoured, not low-slope)', () => {
    const zones = solid_zones_for_spaced_roof(4, false, 22);
    expect(zones.eave_solid_in).toBe(22);
  });
});

describe('ALG-011 — override validation', () => {
  it('override below min (10) on normal slope → SheathingSpecViolation', () => {
    expect(() => solid_zones_for_spaced_roof(6, false, 10))
      .toThrow(SheathingSpecViolation);
    try {
      solid_zones_for_spaced_roof(6, false, 10);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('12"');
      expect(msg).toContain('24"');
    }
  });

  it('override above max (30) on normal slope → SheathingSpecViolation', () => {
    expect(() => solid_zones_for_spaced_roof(6, false, 30))
      .toThrow(SheathingSpecViolation);
  });

  it('override 0 on normal slope → SheathingSpecViolation', () => {
    expect(() => solid_zones_for_spaced_roof(6, false, 0))
      .toThrow(SheathingSpecViolation);
  });

  // Low-slope IGNORES override — even an out-of-range one, no throw
  it('override 10 on low slope → no throw (low-slope ignores override)', () => {
    // Contentious design — arguably we should reject out-of-range
    // overrides even on low slope. Current choice: low slope's 36
    // physics rule SHORT-CIRCUITS before validation, because the
    // override is semantically irrelevant there. Pinned so any
    // future change is deliberate.
    expect(() => solid_zones_for_spaced_roof(3, false, 10)).not.toThrow();
    expect(solid_zones_for_spaced_roof(3, false, 10).eave_solid_in)
      .toBe(EAVE_SOLID_LOW_SLOPE_IN);
  });
});

describe('ALG-011 — geometry guards', () => {
  it('negative slope → InvalidGeometry', () => {
    expect(() => solid_zones_for_spaced_roof(-1, false))
      .toThrow(InvalidGeometry);
  });

  it('NaN slope → InvalidGeometry', () => {
    expect(() => solid_zones_for_spaced_roof(Number.NaN, false))
      .toThrow(InvalidGeometry);
  });

  it('Infinity slope → InvalidGeometry', () => {
    expect(() => solid_zones_for_spaced_roof(Number.POSITIVE_INFINITY, false))
      .toThrow(InvalidGeometry);
  });
});

describe('ALG-011 — constant-carried fields unchanged', () => {
  it('ridge_solid_each_side_in is always 18 (not affected by override/slope)', () => {
    const a = solid_zones_for_spaced_roof(6, false);
    const b = solid_zones_for_spaced_roof(6, false, 22);
    const c = solid_zones_for_spaced_roof(3, false);
    expect(a.ridge_solid_each_side_in).toBe(18);
    expect(b.ridge_solid_each_side_in).toBe(18);
    expect(c.ridge_solid_each_side_in).toBe(18);
  });

  it('eave_protection_membrane_min_in is always 36 (not affected by override/slope)', () => {
    const a = solid_zones_for_spaced_roof(6, false);
    const b = solid_zones_for_spaced_roof(6, false, 22);
    const c = solid_zones_for_spaced_roof(3, false);
    expect(a.eave_protection_membrane_min_in).toBe(36);
    expect(b.eave_protection_membrane_min_in).toBe(36);
    expect(c.eave_protection_membrane_min_in).toBe(36);
  });
});
