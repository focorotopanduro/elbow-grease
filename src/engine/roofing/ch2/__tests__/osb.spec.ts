/**
 * ALG-013 — OSB / waferboard span validation tests.
 */

import { describe, it, expect } from 'vitest';
import {
  osb_max_span_for_thickness,
  osb_meets_min_thickness,
  parse_fractional_thickness_in,
  validate_osb_spec,
} from '../algorithms/osb';
import { SheathingSpecViolation } from '../errors';
import { OSB_MIN_THICKNESS_IN } from '../constants';

describe('ALG-013 osb_max_span_for_thickness', () => {
  it('3/8" → 16" max span', () => {
    expect(osb_max_span_for_thickness('3/8')).toBe(16);
  });

  it('7/16" → 24" max span', () => {
    expect(osb_max_span_for_thickness('7/16')).toBe(24);
  });

  it('1/2" → 24" max span', () => {
    expect(osb_max_span_for_thickness('1/2')).toBe(24);
  });

  it('unknown thickness → SheathingSpecViolation listing valid options', () => {
    expect(() => osb_max_span_for_thickness('11/16')).toThrow(SheathingSpecViolation);
    try {
      osb_max_span_for_thickness('11/16');
    } catch (e) {
      expect((e as Error).message).toContain('3/8');
      expect((e as Error).message).toContain('7/16');
      expect((e as Error).message).toContain('1/2');
    }
  });
});

describe('ALG-013 parse_fractional_thickness_in', () => {
  it('"15/32" → 0.46875', () => {
    expect(parse_fractional_thickness_in('15/32')).toBeCloseTo(15 / 32, 5);
  });

  it('"1/2" → 0.5', () => {
    expect(parse_fractional_thickness_in('1/2')).toBe(0.5);
  });

  it('decimal "0.5" → 0.5', () => {
    expect(parse_fractional_thickness_in('0.5')).toBe(0.5);
  });

  it('malformed "abc" → SheathingSpecViolation', () => {
    expect(() => parse_fractional_thickness_in('abc')).toThrow(SheathingSpecViolation);
  });

  it('zero denominator "1/0" → SheathingSpecViolation', () => {
    expect(() => parse_fractional_thickness_in('1/0')).toThrow(SheathingSpecViolation);
  });
});

describe('ALG-013 osb_meets_min_thickness', () => {
  it('15/32 (min) → true (boundary)', () => {
    expect(osb_meets_min_thickness(OSB_MIN_THICKNESS_IN)).toBe(true);
  });

  it('14/32 → false (below min)', () => {
    expect(osb_meets_min_thickness(14 / 32)).toBe(false);
  });

  it('1/2 → true', () => {
    expect(osb_meets_min_thickness(0.5)).toBe(true);
  });
});

describe('ALG-013 validate_osb_spec (combined)', () => {
  it('15/32 OSB at 24" spacing → throws (15/32 tabulated max is 24", but 15/32 is not in WAFERBOARD_MAX_SPAN_IN table)', () => {
    // 15/32 isn't one of the three tabulated OSB sizes — the spec
    // only tabulates 3/8, 7/16, 1/2. 15/32 ≈ 0.469 is closer to
    // 7/16 but isn't a key. Expect the span lookup to fail.
    expect(() => validate_osb_spec('15/32', 24)).toThrow(SheathingSpecViolation);
  });

  it('1/2 OSB at 24" spacing → passes (meets 15/32 min + within span)', () => {
    expect(() => validate_osb_spec('1/2', 24)).not.toThrow();
  });

  it('7/16 OSB at any span → fails (below 15/32 min for OSB)', () => {
    // 7/16 = 0.4375, OSB_MIN_THICKNESS_IN = 15/32 ≈ 0.469. The
    // table `WAFERBOARD_MAX_SPAN_IN` allows 7/16 up to 24" for
    // WAFERBOARD (different material), but for OSB the absolute
    // minimum thickness wins.
    expect(() => validate_osb_spec('7/16', 16)).toThrow(SheathingSpecViolation);
  });

  it('3/8 OSB (below 15/32 absolute min) → fails with min-thickness msg', () => {
    // 3/8 = 0.375. Below 15/32 ≈ 0.469. The min-thickness
    // check fires first, so the error is about thickness, not
    // max span.
    expect(() => validate_osb_spec('3/8', 16)).toThrow(SheathingSpecViolation);
    try {
      validate_osb_spec('3/8', 16);
    } catch (e) {
      expect((e as Error).message).toContain('below');
      expect((e as Error).message).toContain('minimum');
    }
  });
});
