/**
 * ALG-002 — loads math tests.
 *
 * Covers all 7 edge cases from spec §6 ALG-002.
 */

import { describe, it, expect } from 'vitest';
import {
  compute_effective_live_load_psf,
  compute_total_dead_load_psf,
} from '../algorithms/loads';

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

  // Row 6 — negative dead: no throw, clamps to baseline (implementation choice)
  it('dead = -1 → effective live = 30 psf (clamped)', () => {
    expect(compute_effective_live_load_psf(-1)).toBe(30);
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
  it('unknown deck_type → throws', () => {
    expect(() => compute_total_dead_load_psf('fake_deck', 'felt_30lb', 2.0))
      .toThrow(/unknown deck_type/);
  });

  it('unknown underlayment_type → throws', () => {
    expect(() => compute_total_dead_load_psf('wood_deck', 'fake_underlayment', 2.0))
      .toThrow(/unknown underlayment_type/);
  });
});
