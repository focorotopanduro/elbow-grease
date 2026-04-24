/**
 * ALG-010 + ALG-012 — Panel expansion gaps + humidity validation.
 *
 * Covers all 3 rows from spec §6 ALG-010 edge-case table plus the
 * ALG-012 mismatch-throw behaviour (spec edge case E-024).
 */

import { describe, it, expect } from 'vitest';
import {
  panel_expansion_gaps,
  validate_gaps_match_humidity,
} from '../algorithms/expansionGaps';
import { HumidityGapMismatch } from '../errors';
import type { ClimateHumidity, ExpansionGaps } from '../types';

describe('ALG-010 panel_expansion_gaps — spec §6 edge cases', () => {
  // Row 1
  it('LOW humidity → end 1/16", side 1/8"', () => {
    const gaps = panel_expansion_gaps('low');
    expect(gaps.end_gap_in).toBeCloseTo(1 / 16, 6);
    expect(gaps.side_gap_in).toBeCloseTo(1 / 8, 6);
  });

  // Row 2
  it('NORMAL humidity → end 1/16", side 1/8" (same as LOW)', () => {
    const gaps = panel_expansion_gaps('normal');
    expect(gaps.end_gap_in).toBeCloseTo(1 / 16, 6);
    expect(gaps.side_gap_in).toBeCloseTo(1 / 8, 6);
  });

  // Row 3 — FL default, gaps double
  it('HIGH humidity (FL) → end 1/8", side 1/4" (both doubled)', () => {
    const gaps = panel_expansion_gaps('high');
    expect(gaps.end_gap_in).toBeCloseTo(1 / 8, 6);
    expect(gaps.side_gap_in).toBeCloseTo(1 / 4, 6);
  });

  it('LOW vs NORMAL produce identical gaps', () => {
    const low = panel_expansion_gaps('low');
    const normal = panel_expansion_gaps('normal');
    expect(low.end_gap_in).toBe(normal.end_gap_in);
    expect(low.side_gap_in).toBe(normal.side_gap_in);
  });

  it('HIGH doubles exactly — end=2×standard end, side=2×standard side', () => {
    const standard = panel_expansion_gaps('normal');
    const high = panel_expansion_gaps('high');
    expect(high.end_gap_in).toBeCloseTo(standard.end_gap_in * 2, 6);
    expect(high.side_gap_in).toBeCloseTo(standard.side_gap_in * 2, 6);
  });

  it('each call returns a fresh ExpansionGaps object (no shared reference)', () => {
    const a = panel_expansion_gaps('high');
    const b = panel_expansion_gaps('high');
    expect(a).not.toBe(b); // different references
    expect(a).toEqual(b);  // identical structurally
  });
});

// ── ALG-012 ────────────────────────────────────────────────────

describe('ALG-012 validate_gaps_match_humidity — spec edge case E-024', () => {
  it('matching LOW gaps → no throw', () => {
    const gaps = panel_expansion_gaps('low');
    expect(() => validate_gaps_match_humidity(gaps, 'low')).not.toThrow();
  });

  it('matching NORMAL gaps → no throw', () => {
    const gaps = panel_expansion_gaps('normal');
    expect(() => validate_gaps_match_humidity(gaps, 'normal')).not.toThrow();
  });

  it('matching HIGH gaps → no throw', () => {
    const gaps = panel_expansion_gaps('high');
    expect(() => validate_gaps_match_humidity(gaps, 'high')).not.toThrow();
  });

  // E-024 canonical case: humidity claims HIGH but gaps are standard
  it('HIGH humidity + STANDARD gaps → HumidityGapMismatch (E-024)', () => {
    const standardGaps = panel_expansion_gaps('normal');
    expect(() => validate_gaps_match_humidity(standardGaps, 'high'))
      .toThrow(HumidityGapMismatch);
    try {
      validate_gaps_match_humidity(standardGaps, 'high');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('high');
      expect(msg).toContain('Regenerate'); // remediation hint present
    }
  });

  // Inverse case: humidity claims NORMAL but gaps are doubled
  it('NORMAL humidity + DOUBLED gaps → HumidityGapMismatch (oversized for climate)', () => {
    const doubledGaps = panel_expansion_gaps('high');
    expect(() => validate_gaps_match_humidity(doubledGaps, 'normal'))
      .toThrow(HumidityGapMismatch);
  });

  // LOW and NORMAL share the same gap values — same-gaps across
  // should validate against either humidity without throwing.
  it('LOW gaps validated against NORMAL humidity → no throw (same values)', () => {
    const lowGaps = panel_expansion_gaps('low');
    expect(() => validate_gaps_match_humidity(lowGaps, 'normal')).not.toThrow();
  });

  // Adversarial: hand-built gaps that mix standard/doubled
  it('Mixed gaps (end standard + side doubled) → HumidityGapMismatch', () => {
    const weirdGaps: ExpansionGaps = { end_gap_in: 1 / 16, side_gap_in: 1 / 4 };
    expect(() => validate_gaps_match_humidity(weirdGaps, 'high'))
      .toThrow(HumidityGapMismatch);
    expect(() => validate_gaps_match_humidity(weirdGaps, 'normal'))
      .toThrow(HumidityGapMismatch);
  });

  // Exact equality — no floating-point tolerance
  it('sub-epsilon drift (1/16 + ε) against LOW → throws (exact match required)', () => {
    const drifted: ExpansionGaps = {
      end_gap_in: 1 / 16 + 1e-10,
      side_gap_in: 1 / 8,
    };
    expect(() => validate_gaps_match_humidity(drifted, 'low'))
      .toThrow(HumidityGapMismatch);
  });
});

describe('ALG-010/012 — round-trip invariant', () => {
  // For every humidity class, ALG-010 output validates against ALG-012.
  it.each<ClimateHumidity>(['low', 'normal', 'high'])(
    '%s round-trip: panel_expansion_gaps → validate_gaps_match_humidity = pass',
    (humidity) => {
      const gaps = panel_expansion_gaps(humidity);
      expect(() => validate_gaps_match_humidity(gaps, humidity)).not.toThrow();
    },
  );
});
