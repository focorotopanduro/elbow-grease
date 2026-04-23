/**
 * junctionConstants — Phase 14.AD.14 consolidation regression tests.
 *
 * Locks the single canonical `JUNCTION_TOLERANCE_FT` value and the
 * derived squared variant. Also ensures every subsystem that needs
 * "are these endpoints at the same vertex?" classification shares
 * the same number — prior inconsistency (renderers at 0.1 while
 * generator at 0.15) let fittings emit at gaps the renderers
 * wouldn't retract for, leaving the pipe body overlapping the
 * fitting hub.
 */

import { describe, it, expect } from 'vitest';
import { JUNCTION_TOLERANCE_FT, JUNCTION_TOLERANCE_FT_SQ } from '../junctionConstants';

describe('junctionConstants', () => {
  it('JUNCTION_TOLERANCE_FT is 0.15 feet (1.8 inches)', () => {
    expect(JUNCTION_TOLERANCE_FT).toBe(0.15);
  });

  it('squared variant matches FT × FT', () => {
    expect(JUNCTION_TOLERANCE_FT_SQ).toBeCloseTo(0.0225, 6);
    expect(JUNCTION_TOLERANCE_FT_SQ).toBe(JUNCTION_TOLERANCE_FT * JUNCTION_TOLERANCE_FT);
  });

  it('tolerance is generous enough for floating-point drift but tighter than snap grid', () => {
    // Draw snap grid is 0.5 ft. The tolerance must be comfortably
    // below that so two intentionally-separate pipes (at adjacent
    // grid cells) don't register as a junction.
    expect(JUNCTION_TOLERANCE_FT).toBeLessThan(0.5);
    // And above typical click-noise (a few thousandths).
    expect(JUNCTION_TOLERANCE_FT).toBeGreaterThan(0.01);
  });
});
