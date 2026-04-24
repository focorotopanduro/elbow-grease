/**
 * ALG-014 gable + ALG-015 hip tile-loading-pattern tests.
 *
 * Covers all 3 spec §6 ALG-014 edge-case rows plus ridge-priority
 * invariants and the hip-stub flag path.
 */

import { describe, it, expect } from 'vitest';
import {
  GABLE_TILE_GENERAL_RULES,
  HIP_TILE_GENERAL_RULES,
  gable_tile_loading_pattern,
  hip_tile_loading_pattern,
} from '../algorithms/tileStaging';
import { InvalidGeometry } from '../errors';
import type { WarningFlag } from '../types';

describe('ALG-014 gable_tile_loading_pattern — spec §6 edge cases', () => {
  // Row 1 — slope_courses = 10 → stacks at 4, 8, 10
  it('slope_courses=10 → stacks at courses 4, 8, 10 (sizes 8, 8, 4)', () => {
    const { stacks } = gable_tile_loading_pattern(10);
    expect(stacks).toHaveLength(3);
    expect(stacks[0]).toEqual({ course: 4, stack_size: 8, horizontal_gap_ft: 1.0 });
    expect(stacks[1]).toEqual({ course: 8, stack_size: 8, horizontal_gap_ft: 1.0 });
    expect(stacks[2]).toEqual({ course: 10, stack_size: 4, horizontal_gap_ft: 1.0 });
  });

  // Row 2 — slope_courses = 3 → ridge only
  it('slope_courses=3 → ridge stack only (course 3, size 4)', () => {
    const { stacks } = gable_tile_loading_pattern(3);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toEqual({ course: 3, stack_size: 4, horizontal_gap_ft: 1.0 });
  });

  // Row 3 — slope_courses = 0 → throws
  it('slope_courses=0 → InvalidGeometry', () => {
    expect(() => gable_tile_loading_pattern(0)).toThrow(InvalidGeometry);
  });
});

describe('ALG-014 — ridge-priority over every-4th rule', () => {
  // Key invariant: when ridge course IS divisible by 4, ridge
  // (size 4) wins over every-4th (size 8). NO duplicate entries.
  it('slope_courses=4 → single ridge stack at 4 (size 4, not 8)', () => {
    const { stacks } = gable_tile_loading_pattern(4);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toEqual({ course: 4, stack_size: 4, horizontal_gap_ft: 1.0 });
  });

  it('slope_courses=8 → stacks at 4 (size 8) and 8 (size 4)', () => {
    const { stacks } = gable_tile_loading_pattern(8);
    expect(stacks).toHaveLength(2);
    expect(stacks[0]).toEqual({ course: 4, stack_size: 8, horizontal_gap_ft: 1.0 });
    expect(stacks[1]).toEqual({ course: 8, stack_size: 4, horizontal_gap_ft: 1.0 });
  });

  it('slope_courses=12 → stacks at 4 (8), 8 (8), 12 (4)', () => {
    const { stacks } = gable_tile_loading_pattern(12);
    expect(stacks).toHaveLength(3);
    expect(stacks.map((s) => s.course)).toEqual([4, 8, 12]);
    expect(stacks.map((s) => s.stack_size)).toEqual([8, 8, 4]);
  });
});

describe('ALG-014 — boundary + fractional inputs', () => {
  it('slope_courses=1 → single ridge stack at 1', () => {
    const { stacks } = gable_tile_loading_pattern(1);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.course).toBe(1);
    expect(stacks[0]?.stack_size).toBe(4);
  });

  it('slope_courses=2 → single ridge stack at 2', () => {
    const { stacks } = gable_tile_loading_pattern(2);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.course).toBe(2);
    expect(stacks[0]?.stack_size).toBe(4);
  });

  it('slope_courses=10.7 → floored to 10 (same output as 10)', () => {
    const { stacks: a } = gable_tile_loading_pattern(10.7);
    const { stacks: b } = gable_tile_loading_pattern(10);
    expect(a).toEqual(b);
  });

  it('negative slope_courses → InvalidGeometry', () => {
    expect(() => gable_tile_loading_pattern(-1)).toThrow(InvalidGeometry);
  });

  it('NaN → InvalidGeometry', () => {
    expect(() => gable_tile_loading_pattern(Number.NaN)).toThrow(InvalidGeometry);
  });
});

describe('ALG-014 — general_rules carried', () => {
  it('output.general_rules is the frozen GABLE_TILE_GENERAL_RULES constant', () => {
    const { general_rules } = gable_tile_loading_pattern(10);
    expect(general_rules).toBe(GABLE_TILE_GENERAL_RULES);
    expect(general_rules.length).toBeGreaterThan(0);
    // Rules mention both the every-4th and the ridge pattern + pre-load
    const joined = general_rules.join(' ');
    expect(joined).toContain('4th course');
    expect(joined).toContain('ridge');
    expect(joined.toLowerCase()).toContain('reroof');
  });

  it('GABLE_TILE_GENERAL_RULES is frozen', () => {
    expect(Object.isFrozen(GABLE_TILE_GENERAL_RULES)).toBe(true);
  });
});

// ── ALG-015 hip stub ──────────────────────────────────────────

describe('ALG-015 hip_tile_loading_pattern — stub behaviour', () => {
  it('returns empty stacks array (course-length-scaled values not yet implemented)', () => {
    const { stacks } = hip_tile_loading_pattern(10);
    expect(stacks).toEqual([]);
  });

  it('returns HIP_TILE_GENERAL_RULES (frozen reference)', () => {
    const { general_rules } = hip_tile_loading_pattern(10);
    expect(general_rules).toBe(HIP_TILE_GENERAL_RULES);
  });

  it('HIP_TILE_GENERAL_RULES is frozen', () => {
    expect(Object.isFrozen(HIP_TILE_GENERAL_RULES)).toBe(true);
  });

  it('general rules cover the four spec-mandated points', () => {
    const joined = HIP_TILE_GENERAL_RULES.join(' ').toLowerCase();
    expect(joined).toContain('1 ft');        // horizontal spacing
    expect(joined).toContain('multiple');    // multiple pallets
    expect(joined).toContain('reroof');      // pre-load on reroof
    expect(joined).toContain('narrows');     // course-length caveat
  });

  it('with flags array → appends hip_tile_loading_review_needed warning', () => {
    const flags: WarningFlag[] = [];
    hip_tile_loading_pattern(10, flags);
    const flag = flags.find((f) => f.code === 'hip_tile_loading_review_needed');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('warning');
    expect(flag?.remediation).toBeDefined();
  });

  it('without flags argument → no throw', () => {
    expect(() => hip_tile_loading_pattern(10)).not.toThrow();
  });

  it('slope_courses=0 → InvalidGeometry (even for stub)', () => {
    expect(() => hip_tile_loading_pattern(0)).toThrow(InvalidGeometry);
  });

  it('negative slope_courses → InvalidGeometry', () => {
    expect(() => hip_tile_loading_pattern(-5)).toThrow(InvalidGeometry);
  });
});

// ── Parity invariant — hip + gable share horizontal gap ───────

describe('ALG-014 / ALG-015 — shared horizontal gap constant', () => {
  it('both rule sets cite the same 1 ft horizontal spacing', () => {
    const gable_joined = GABLE_TILE_GENERAL_RULES.join(' ');
    const hip_joined = HIP_TILE_GENERAL_RULES.join(' ');
    expect(gable_joined).toContain('1 ft');
    expect(hip_joined).toContain('1 ft');
  });
});
