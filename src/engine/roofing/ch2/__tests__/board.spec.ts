/**
 * ALG-004 — `nails_per_rafter_for_board` tests.
 *
 * Covers all 6 rows from spec §6 ALG-004 edge-case table plus
 * flag-path assertions for the book's 1×6-max recommendation.
 */

import { describe, it, expect } from 'vitest';
import { nails_per_rafter_for_board } from '../algorithms/board';
import { InvalidGeometry } from '../errors';
import type { WarningFlag } from '../types';

describe('ALG-004 nails_per_rafter_for_board — spec §6 edge cases', () => {
  // Row 1
  it('1×4 → 2 nails per rafter', () => {
    expect(nails_per_rafter_for_board(4)).toBe(2);
  });

  // Row 2
  it('1×6 → 2 nails per rafter', () => {
    expect(nails_per_rafter_for_board(6)).toBe(2);
  });

  // Row 3 — boundary
  it('1×8 (boundary) → 2 nails per rafter (≤ 8 path)', () => {
    expect(nails_per_rafter_for_board(8)).toBe(2);
  });

  // Row 4
  it('1×10 → 3 nails per rafter', () => {
    expect(nails_per_rafter_for_board(10)).toBe(3);
  });

  // Row 5
  it('1×12 → 3 nails per rafter', () => {
    expect(nails_per_rafter_for_board(12)).toBe(3);
  });

  // Row 6
  it('0 → InvalidGeometry', () => {
    expect(() => nails_per_rafter_for_board(0)).toThrow(InvalidGeometry);
  });

  it('negative → InvalidGeometry', () => {
    expect(() => nails_per_rafter_for_board(-1)).toThrow(InvalidGeometry);
  });

  it('NaN → InvalidGeometry', () => {
    expect(() => nails_per_rafter_for_board(Number.NaN)).toThrow(InvalidGeometry);
  });

  it('Infinity → InvalidGeometry', () => {
    expect(() => nails_per_rafter_for_board(Number.POSITIVE_INFINITY))
      .toThrow(InvalidGeometry);
  });
});

describe('ALG-004 — book-recommended width flag', () => {
  it('1×6 (at recommended max) → no flag appended', () => {
    const flags: WarningFlag[] = [];
    nails_per_rafter_for_board(6, flags);
    expect(flags).toHaveLength(0);
  });

  it('1×8 (above recommended) → appends `board_wider_than_recommended` info', () => {
    const flags: WarningFlag[] = [];
    nails_per_rafter_for_board(8, flags);
    const flag = flags.find((f) => f.code === 'board_wider_than_recommended');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('info');
    expect(flag?.message).toContain('8');
    expect(flag?.remediation).toBeDefined();
  });

  it('1×12 (well above recommended) → flag appended AND nail count = 3', () => {
    const flags: WarningFlag[] = [];
    const count = nails_per_rafter_for_board(12, flags);
    expect(count).toBe(3);
    expect(flags.some((f) => f.code === 'board_wider_than_recommended')).toBe(true);
  });

  it('flags argument omitted → never throws regardless of width', () => {
    expect(() => nails_per_rafter_for_board(12)).not.toThrow();
    expect(() => nails_per_rafter_for_board(4)).not.toThrow();
  });
});
