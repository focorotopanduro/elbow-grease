/**
 * ALG-005 — `spaced_sheathing_layout` tests.
 *
 * Covers all 6 rows from spec §6 ALG-005 edge-case table plus
 * boundary + default-method + discriminated-union exhaustiveness
 * tests.
 */

import { describe, it, expect } from 'vitest';
import { spaced_sheathing_layout } from '../algorithms/spaced';
import { InvalidGeometry, SheathingSpecViolation } from '../errors';
import type { SpacedBoardLayout } from '../types';

describe('ALG-005 spaced_sheathing_layout — spec §6 edge cases', () => {
  // Row 1 — shake boundary at 2.5" (should PASS, not fail)
  it('wood_shake, exposure = 2.5" (boundary) → 1×6, spacing 2.5", kind=single_per_course', () => {
    const layout = spaced_sheathing_layout('wood_shake', 2.5);
    expect(layout.kind).toBe('single_per_course');
    if (layout.kind === 'single_per_course') {
      expect(layout.board_nominal_in).toBe(6);
      expect(layout.center_spacing_in).toBe(2.5);
    }
  });

  // Row 2 — shake one tick past 2.5" cap → THROWS
  it('wood_shake, exposure = 2.6" → SheathingSpecViolation (interlayment cap)', () => {
    expect(() => spaced_sheathing_layout('wood_shake', 2.6))
      .toThrow(SheathingSpecViolation);
    try {
      spaced_sheathing_layout('wood_shake', 2.6);
    } catch (e) {
      expect((e as Error).message).toContain('2.5');
      expect((e as Error).message).toContain('interlayment');
    }
  });

  // Row 3 — shingle Method 1
  it('wood_shingle, 1x4_one_per_course, exposure 5.5" → 1×4, spacing 5.5"', () => {
    const layout = spaced_sheathing_layout('wood_shingle', 5.5, '1x4_one_per_course');
    expect(layout.kind).toBe('single_per_course');
    if (layout.kind === 'single_per_course') {
      expect(layout.board_nominal_in).toBe(4);
      expect(layout.center_spacing_in).toBe(5.5);
    }
  });

  // Row 4 — shingle Method 2 at exposure ≤ 5.5 → two_per_course
  it('wood_shingle, 1x6_two_per_course, exposure 5.5" → kind=two_per_course, 1×6', () => {
    const layout = spaced_sheathing_layout('wood_shingle', 5.5, '1x6_two_per_course');
    expect(layout.kind).toBe('two_per_course');
    if (layout.kind === 'two_per_course') {
      expect(layout.board_nominal_in).toBe(6);
      expect(layout.exposure_in).toBe(5.5);
    }
  });

  // Row 5 — shingle Method 2 at exposure > 5.5 → degrades to single
  it('wood_shingle, 1x6_two_per_course, exposure 7.5" → kind=single_per_course, 1×6, 7.5"', () => {
    const layout = spaced_sheathing_layout('wood_shingle', 7.5, '1x6_two_per_course');
    expect(layout.kind).toBe('single_per_course');
    if (layout.kind === 'single_per_course') {
      expect(layout.board_nominal_in).toBe(6);
      expect(layout.center_spacing_in).toBe(7.5);
    }
  });

  // Row 6 — non-wood covering rejected
  it('asphalt_shingle → SheathingSpecViolation (not a wood covering)', () => {
    expect(() => spaced_sheathing_layout('asphalt_shingle', 5))
      .toThrow(SheathingSpecViolation);
    try {
      spaced_sheathing_layout('asphalt_shingle', 5);
    } catch (e) {
      expect((e as Error).message).toContain('wood');
    }
  });
});

describe('ALG-005 — boundary + degenerate inputs', () => {
  it('exposure = 0 → InvalidGeometry', () => {
    expect(() => spaced_sheathing_layout('wood_shake', 0))
      .toThrow(InvalidGeometry);
  });

  it('exposure = -1 → InvalidGeometry', () => {
    expect(() => spaced_sheathing_layout('wood_shingle', -1))
      .toThrow(InvalidGeometry);
  });

  it('exposure NaN → InvalidGeometry', () => {
    expect(() => spaced_sheathing_layout('wood_shake', Number.NaN))
      .toThrow(InvalidGeometry);
  });

  it('exposure Infinity → InvalidGeometry', () => {
    expect(() => spaced_sheathing_layout('wood_shake', Number.POSITIVE_INFINITY))
      .toThrow(InvalidGeometry);
  });

  // Method 2 boundary — 5.5 is exactly at the divide.
  // ≤ 5.5 = two_per_course, > 5.5 = single_per_course.
  it('Method 2 exposure 5.501" → single_per_course (just past 5.5 threshold)', () => {
    const layout = spaced_sheathing_layout('wood_shingle', 5.501, '1x6_two_per_course');
    expect(layout.kind).toBe('single_per_course');
  });

  it('Method 2 exposure 5.5" exactly → two_per_course (≤ inclusive)', () => {
    const layout = spaced_sheathing_layout('wood_shingle', 5.5, '1x6_two_per_course');
    expect(layout.kind).toBe('two_per_course');
  });

  // Shake max cap — same inclusive/exclusive logic as Method 2
  it('Shake exposure = 2.5001 → SheathingSpecViolation (> cap strict)', () => {
    expect(() => spaced_sheathing_layout('wood_shake', 2.5001))
      .toThrow(SheathingSpecViolation);
  });
});

describe('ALG-005 — method default + discriminated-union exhaustiveness', () => {
  it('default method = 1x4_one_per_course for shingles', () => {
    // No third argument — should use 1x4 Method 1 per spec default.
    const layout = spaced_sheathing_layout('wood_shingle', 5.0);
    expect(layout.kind).toBe('single_per_course');
    if (layout.kind === 'single_per_course') {
      expect(layout.board_nominal_in).toBe(4);
    }
  });

  it('method argument IGNORED for shakes (shakes always use 1×6)', () => {
    // Even if we pass 1x6_two_per_course for a shake, the shake
    // branch overrides — 1×6 single-per-course regardless.
    const layout = spaced_sheathing_layout('wood_shake', 2, '1x6_two_per_course');
    expect(layout.kind).toBe('single_per_course');
    if (layout.kind === 'single_per_course') {
      expect(layout.board_nominal_in).toBe(6);
    }
  });

  it('union discriminant enables type-narrowed consumer code', () => {
    // Compile-time test: if the `kind` union ever gains a third
    // variant without exhaustiveness handling, the following
    // function won't compile. Keeps callers honest.
    const assert_exhaustive = (layout: SpacedBoardLayout): number => {
      switch (layout.kind) {
        case 'single_per_course':
          return layout.center_spacing_in;
        case 'two_per_course':
          return layout.exposure_in;
      }
    };
    const shake = spaced_sheathing_layout('wood_shake', 2);
    const shingle = spaced_sheathing_layout('wood_shingle', 5, '1x6_two_per_course');
    expect(assert_exhaustive(shake)).toBeGreaterThan(0);
    expect(assert_exhaustive(shingle)).toBeGreaterThan(0);
  });
});
