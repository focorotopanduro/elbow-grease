/**
 * ALG-008 (nail) + ALG-009 (staple) schedule tests.
 *
 * Covers spec §6 edge cases + the 0.5"-boundary behaviour pinned
 * in E-034 / E-035 of the edge-case matrix.
 */

import { describe, it, expect } from 'vitest';
import {
  nail_schedule_for_panel,
  staple_schedule_for_panel,
} from '../algorithms/fasteners';
import { InvalidGeometry } from '../errors';

describe('ALG-008 nail_schedule_for_panel — spec §6 edge cases', () => {
  // Row 1 — 0.5" panel, prefer_ring=false → 6d common
  it('thickness 0.5 + prefer_ring=false → common_6d, 6"/12"', () => {
    const spec = nail_schedule_for_panel(0.5, false);
    expect(spec.mode).toBe('nail');
    expect(spec.nail_type).toBe('common_6d');
    expect(spec.edge_oc_in).toBe(6);
    expect(spec.field_oc_in).toBe(12);
    expect(spec.staple_gauge).toBeNull();
    expect(spec.staple_crown_in).toBeNull();
    expect(spec.staple_length_in).toBeNull();
  });

  // Row 2 — 0.5" panel, prefer_ring=true → 8d ring-shank (UPGRADED size)
  it('thickness 0.5 + prefer_ring=true → ring_shank_8d (size upgrade), 6"/12"', () => {
    const spec = nail_schedule_for_panel(0.5, true);
    expect(spec.nail_type).toBe('ring_shank_8d');
    expect(spec.edge_oc_in).toBe(6);
    expect(spec.field_oc_in).toBe(12);
  });

  // Row 3 — 15/32" panel (0.46875) → light path, 6d common
  it('thickness 15/32 ≈ 0.469 → common_6d (light path, ≤ 0.5)', () => {
    const spec = nail_schedule_for_panel(15 / 32, false);
    expect(spec.nail_type).toBe('common_6d');
  });

  // Row 4 — 0.5001" panel → heavy path
  it('thickness 0.5001 + prefer_ring=false → common_8d (heavy path, > 0.5)', () => {
    const spec = nail_schedule_for_panel(0.5001, false);
    expect(spec.nail_type).toBe('common_8d');
  });

  // Heavy + ring-shank
  it('thickness 0.5001 + prefer_ring=true → ring_shank_8d', () => {
    const spec = nail_schedule_for_panel(0.5001, true);
    expect(spec.nail_type).toBe('ring_shank_8d');
  });

  // Default prefer_ring_shank=true (matches HVHZ FL expectation)
  it('default prefer_ring_shank is true (HVHZ-friendly)', () => {
    const spec = nail_schedule_for_panel(0.5);
    expect(spec.nail_type).toBe('ring_shank_8d');
  });

  // Invalid inputs
  it('thickness 0 → InvalidGeometry', () => {
    expect(() => nail_schedule_for_panel(0)).toThrow(InvalidGeometry);
  });

  it('thickness negative → InvalidGeometry', () => {
    expect(() => nail_schedule_for_panel(-0.5)).toThrow(InvalidGeometry);
  });

  it('thickness NaN → InvalidGeometry', () => {
    expect(() => nail_schedule_for_panel(Number.NaN)).toThrow(InvalidGeometry);
  });

  it('thickness Infinity → InvalidGeometry', () => {
    expect(() => nail_schedule_for_panel(Number.POSITIVE_INFINITY))
      .toThrow(InvalidGeometry);
  });
});

describe('ALG-009 staple_schedule_for_panel — spec §6 edge cases', () => {
  // Row E-036 — 1/2" panel → light schedule
  it('thickness 1/2 → 16ga, 3/8" crown, 1.5" long, 4"/8" o.c. (light)', () => {
    const spec = staple_schedule_for_panel(0.5);
    expect(spec.mode).toBe('staple');
    expect(spec.nail_type).toBeNull();
    expect(spec.staple_gauge).toBe(16);
    expect(spec.staple_crown_in).toBeCloseTo(3 / 8, 5);
    expect(spec.staple_length_in).toBeCloseTo(0.5 + 1, 5);
    expect(spec.edge_oc_in).toBe(4);
    expect(spec.field_oc_in).toBe(8);
  });

  // Row E-037 — 5/8" panel → heavy schedule
  it('thickness 5/8 → 16ga, 3/8" crown, 1.625" long, 2"/5" o.c. (heavy)', () => {
    const spec = staple_schedule_for_panel(5 / 8);
    expect(spec.staple_gauge).toBe(16);
    expect(spec.staple_crown_in).toBeCloseTo(3 / 8, 5);
    expect(spec.staple_length_in).toBeCloseTo(5 / 8 + 1, 5);
    expect(spec.edge_oc_in).toBe(2);
    expect(spec.field_oc_in).toBe(5);
  });

  // Light/heavy boundary behaviour
  it('thickness 15/32 ≈ 0.469 → light (≤ 0.5)', () => {
    const spec = staple_schedule_for_panel(15 / 32);
    expect(spec.edge_oc_in).toBe(4);
    expect(spec.field_oc_in).toBe(8);
  });

  it('thickness 0.5001 → heavy (> 0.5)', () => {
    const spec = staple_schedule_for_panel(0.5001);
    expect(spec.edge_oc_in).toBe(2);
    expect(spec.field_oc_in).toBe(5);
  });

  // Staple length scales with thickness
  it('thickness 23/32 → length = 23/32 + 1" ≈ 1.719"', () => {
    const spec = staple_schedule_for_panel(23 / 32);
    expect(spec.staple_length_in).toBeCloseTo(23 / 32 + 1, 5);
  });

  // Invalid inputs
  it('thickness 0 → InvalidGeometry', () => {
    expect(() => staple_schedule_for_panel(0)).toThrow(InvalidGeometry);
  });

  it('thickness negative → InvalidGeometry', () => {
    expect(() => staple_schedule_for_panel(-1)).toThrow(InvalidGeometry);
  });
});
