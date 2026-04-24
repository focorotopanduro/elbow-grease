/**
 * ALG-002 — loads math tests.
 *
 * Covers all 7 edge cases from spec §6 ALG-002 plus flag-path
 * assertions, chained helper, and `MissingRequiredInput` typed
 * throw for unknown deck/underlayment keys.
 */

import { describe, it, expect } from 'vitest';
import {
  compute_effective_live_load_psf,
  compute_loads,
  compute_total_dead_load_psf,
} from '../algorithms/loads';
import { MissingRequiredInput } from '../errors';
import type { WarningFlag } from '../types';

describe('ALG-002 compute_effective_live_load_psf — spec §6 edge cases', () => {
  // Row 1
  it('dead = 5 psf → effective live = 30 psf (no excess)', () => {
    expect(compute_effective_live_load_psf(5)).toBe(30);
  });

  // Row 2
  it('dead = 10 psf (boundary) → effective live = 30 psf', () => {
    expect(compute_effective_live_load_psf(10)).toBe(30);
  });

  // Row 3
  it('dead = 10.01 psf → effective live = 30.01 psf', () => {
    expect(compute_effective_live_load_psf(10.01)).toBeCloseTo(30.01, 2);
  });

  // Row 4 — tile example
  it('dead = 20 psf (tile) → effective live = 40 psf', () => {
    expect(compute_effective_live_load_psf(20)).toBe(40);
  });

  // Row 5
  it('dead = 0 → effective live = 30 psf', () => {
    expect(compute_effective_live_load_psf(0)).toBe(30);
  });

  // Row 6 — negative dead: clamps to baseline per Ground Rule #7
  it('dead = -1 → effective live = 30 psf (clamped)', () => {
    expect(compute_effective_live_load_psf(-1)).toBe(30);
  });

  // Row 6 flag-path: when `flags` is provided, negative dead appends a warning
  it('dead = -1 with flags array → appends `negative_dead_load_clamped` warning', () => {
    const flags: WarningFlag[] = [];
    compute_effective_live_load_psf(-1, flags);
    const flag = flags.find((f) => f.code === 'negative_dead_load_clamped');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('warning');
    expect(flag?.remediation).toBeDefined();
  });

  // Non-negative dead + flags: no spurious warnings
  it('dead = 5 with flags array → no warning appended', () => {
    const flags: WarningFlag[] = [];
    compute_effective_live_load_psf(5, flags);
    expect(flags).toHaveLength(0);
  });

  // Flags parameter optional — legacy callers still work
  it('flags argument omitted → no throw on any valid input', () => {
    expect(() => compute_effective_live_load_psf(-1)).not.toThrow();
    expect(() => compute_effective_live_load_psf(0)).not.toThrow();
    expect(() => compute_effective_live_load_psf(100)).not.toThrow();
  });
});

describe('ALG-002 compute_total_dead_load_psf', () => {
  it('asphalt shingle build: wood deck + 30-lb felt + 2.0 psf shingle → 5.3 psf', () => {
    const dead = compute_total_dead_load_psf('wood_deck', 'felt_30lb', 2.0);
    expect(dead).toBeCloseTo(5.3, 2);
  });

  it('clay tile build: wood deck + 30-lb felt + 16 psf tile → 19.3 psf', () => {
    const dead = compute_total_dead_load_psf('wood_deck', 'felt_30lb', 16.0);
    expect(dead).toBeCloseTo(19.3, 2);
    // And the effective live follows: 30 + (19.3 - 10) = 39.3
    expect(compute_effective_live_load_psf(dead)).toBeCloseTo(39.3, 2);
  });

  // Row 7 — unknown deck_type
  it('unknown deck_type → MissingRequiredInput (typed throw)', () => {
    expect(() => compute_total_dead_load_psf('fake_deck', 'felt_30lb', 2.0))
      .toThrow(MissingRequiredInput);
    try {
      compute_total_dead_load_psf('fake_deck', 'felt_30lb', 2.0);
    } catch (e) {
      expect((e as Error).message).toContain('fake_deck');
      expect((e as Error).message).toContain('Valid keys');
    }
  });

  it('unknown underlayment_type → MissingRequiredInput (typed throw)', () => {
    expect(() => compute_total_dead_load_psf('wood_deck', 'fake_underlayment', 2.0))
      .toThrow(MissingRequiredInput);
  });

  // Boundary: covering_weight_psf = 0 (e.g. a membrane with embedded weight)
  it('covering_weight_psf = 0 → sum is deck + underlayment only', () => {
    const dead = compute_total_dead_load_psf('wood_deck', 'felt_15lb', 0);
    expect(dead).toBeCloseTo(3.15, 2);
  });
});

describe('ALG-002 compute_loads (chained helper)', () => {
  it('returns both total_dead_psf AND effective_live_psf', () => {
    const { total_dead_psf, effective_live_psf } = compute_loads(
      'wood_deck', 'felt_30lb', 16,
    );
    expect(total_dead_psf).toBeCloseTo(19.3, 2);
    expect(effective_live_psf).toBeCloseTo(39.3, 2);
  });

  it('appends flag when chained path produces negative dead load', () => {
    const flags: WarningFlag[] = [];
    // Can't actually hit the negative path via the chained helper
    // unless covering_weight_psf is VERY negative, but verify the
    // plumbing. wood_deck (3) + felt_30lb (0.3) + (-5) = -1.7 → negative.
    compute_loads('wood_deck', 'felt_30lb', -5, flags);
    expect(flags.some((f) => f.code === 'negative_dead_load_clamped')).toBe(true);
  });

  it('propagates MissingRequiredInput through the chained helper', () => {
    expect(() => compute_loads('banana_deck', 'felt_30lb', 2))
      .toThrow(MissingRequiredInput);
  });
});
