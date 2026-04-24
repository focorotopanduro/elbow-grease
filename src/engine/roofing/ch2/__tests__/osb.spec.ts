/**
 * ALG-013 — OSB / waferboard span validation tests.
 */

import { describe, it, expect } from 'vitest';
import {
  osb_max_span_for_thickness,
  osb_meets_min_thickness,
  parse_fractional_thickness_in,
  validate_osb_panel_spec,
  validate_osb_spec,
  validate_waferboard_panel_spec,
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

describe('ALG-013 validate_osb_panel_spec (OSB strict)', () => {
  it('1/2 OSB at 24" spacing → passes (meets 15/32 min + within span)', () => {
    expect(() => validate_osb_panel_spec('1/2', 24)).not.toThrow();
  });

  it('1/2 OSB at 16" spacing → passes (well within span)', () => {
    expect(() => validate_osb_panel_spec('1/2', 16)).not.toThrow();
  });

  it('7/16 OSB at any span → fails (below 15/32 min for OSB)', () => {
    expect(() => validate_osb_panel_spec('7/16', 16)).toThrow(SheathingSpecViolation);
    try {
      validate_osb_panel_spec('7/16', 16);
    } catch (e) {
      expect((e as Error).message).toContain('below');
      expect((e as Error).message).toContain('15/32');
    }
  });

  it('3/8 OSB → fails (min thickness); error fires BEFORE span check', () => {
    expect(() => validate_osb_panel_spec('3/8', 16)).toThrow(SheathingSpecViolation);
    try {
      validate_osb_panel_spec('3/8', 16);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('below');
      expect(msg).toContain('minimum');
      // The msg should NOT mention span — min-thickness error fires first.
      expect(msg).not.toContain('supports rafters');
    }
  });

  it('15/32 OSB → fails span lookup (15/32 isn\'t in §2G table)', () => {
    // 15/32 MEETS the min-thickness requirement (it IS the min)
    // but 15/32 isn't one of the tabulated values in §2G (only
    // 3/8, 7/16, 1/2). The min-thickness check passes; the span
    // lookup then fails.
    expect(() => validate_osb_panel_spec('15/32', 24)).toThrow(SheathingSpecViolation);
    try {
      validate_osb_panel_spec('15/32', 24);
    } catch (e) {
      expect((e as Error).message).toContain('not tabulated');
    }
  });
});

describe('ALG-013 validate_waferboard_panel_spec (waferboard, no min-thickness)', () => {
  it('7/16 waferboard at 16" spacing → passes (below 15/32 is OK for waferboard)', () => {
    expect(() => validate_waferboard_panel_spec('7/16', 16)).not.toThrow();
  });

  it('7/16 waferboard at 24" spacing → passes (at max)', () => {
    expect(() => validate_waferboard_panel_spec('7/16', 24)).not.toThrow();
  });

  it('3/8 waferboard at 16" spacing → passes', () => {
    expect(() => validate_waferboard_panel_spec('3/8', 16)).not.toThrow();
  });

  it('3/8 waferboard at 24" spacing → fails (3/8 max is 16")', () => {
    expect(() => validate_waferboard_panel_spec('3/8', 24)).toThrow(SheathingSpecViolation);
    try {
      validate_waferboard_panel_spec('3/8', 24);
    } catch (e) {
      expect((e as Error).message).toContain('up to 16"');
    }
  });

  it('1/2 waferboard at 24" spacing → passes', () => {
    expect(() => validate_waferboard_panel_spec('1/2', 24)).not.toThrow();
  });

  it('unknown thickness → throws with valid-values list', () => {
    expect(() => validate_waferboard_panel_spec('9/16', 16)).toThrow(SheathingSpecViolation);
  });
});

describe('ALG-013 — validate_osb_spec back-compat alias', () => {
  it('aliases `validate_osb_panel_spec` for legacy callers', () => {
    expect(validate_osb_spec).toBe(validate_osb_panel_spec);
  });
});
