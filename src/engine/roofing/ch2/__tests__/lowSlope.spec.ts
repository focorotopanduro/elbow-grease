/**
 * ALG-006 — `low_slope_wood_layer_stack` tests.
 *
 * Covers all 3 rows from spec §6 ALG-006 plus boundary tests.
 */

import { describe, it, expect } from 'vitest';
import {
  LOW_SLOPE_WOOD_BUILD_UP_STACK,
  low_slope_wood_layer_stack,
} from '../algorithms/lowSlope';
import { SheathingSpecViolation } from '../errors';
import type { WarningFlag } from '../types';

describe('ALG-006 low_slope_wood_layer_stack — spec §6 edge cases', () => {
  // Row 1
  it('slope = 3:12 → returns 10-layer stack', () => {
    const stack = low_slope_wood_layer_stack(3);
    expect(stack).toHaveLength(10);
    expect(stack[0]).toBe('solid_sheathing');
    expect(stack[9]).toBe('2_nails_per_shake');
  });

  // Row 2 — boundary at 4:12 (EXCLUSIVE upper bound)
  it('slope = 4:12 (boundary) → throws (use ALG-005)', () => {
    expect(() => low_slope_wood_layer_stack(4)).toThrow(SheathingSpecViolation);
    try {
      low_slope_wood_layer_stack(4);
    } catch (e) {
      expect((e as Error).message).toContain('ALG-005');
    }
  });

  // Row 3 — extreme low slope (0:12) returns stack + flag
  it('slope = 0:12 with flags → returns stack + extreme_low_slope flag', () => {
    const flags: WarningFlag[] = [];
    const stack = low_slope_wood_layer_stack(0, flags);
    expect(stack).toHaveLength(10);
    const flag = flags.find(
      (f) => f.code === 'extreme_low_slope_review_ch10_builtup',
    );
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('warning');
  });

  // Row 3 variant — no flags array passed → no throw, just returns
  it('slope = 0:12 without flags → returns stack (no throw, no flag)', () => {
    expect(() => low_slope_wood_layer_stack(0)).not.toThrow();
    const stack = low_slope_wood_layer_stack(0);
    expect(stack).toHaveLength(10);
  });

  it('slope = 1:12 → returns stack, no flag (1:12 is in the "normal" low-slope range)', () => {
    const flags: WarningFlag[] = [];
    const stack = low_slope_wood_layer_stack(1, flags);
    expect(stack).toHaveLength(10);
    expect(flags).toHaveLength(0);
  });

  // Edge — 3.99 is just under boundary
  it('slope = 3.99:12 → returns stack', () => {
    const stack = low_slope_wood_layer_stack(3.99);
    expect(stack).toHaveLength(10);
  });

  it('slope = 4.01:12 → throws (above boundary)', () => {
    expect(() => low_slope_wood_layer_stack(4.01)).toThrow(SheathingSpecViolation);
  });
});

describe('ALG-006 — exported constant + frozen-ness', () => {
  it('LOW_SLOPE_WOOD_BUILD_UP_STACK is exported with the canonical 10 entries', () => {
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK).toHaveLength(10);
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[0]).toBe('solid_sheathing');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[1]).toBe('36in_felt_underlay');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[2]).toBe('hot_mop_built_up');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[3]).toBe('15in_shake_starter_course');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[4]).toBe('18in_felt_overlay_between_courses');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[5]).toBe('2x4_spacers_at_24in_oc');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[6]).toBe('1x4_or_1x6_nailing_strips');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[7]).toBe('4in_felt_overlap_between_courses');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[8]).toBe('24in_handsplit_resawn_shakes_at_10in_exposure');
    expect(LOW_SLOPE_WOOD_BUILD_UP_STACK[9]).toBe('2_nails_per_shake');
  });

  it('returned stack is the same frozen reference as the constant', () => {
    expect(low_slope_wood_layer_stack(2)).toBe(LOW_SLOPE_WOOD_BUILD_UP_STACK);
  });

  it('the stack is frozen (mutation throws in strict mode)', () => {
    expect(Object.isFrozen(LOW_SLOPE_WOOD_BUILD_UP_STACK)).toBe(true);
  });
});
