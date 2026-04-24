/**
 * ALG-003 — APA panel selection tests.
 *
 * Covers spec §6 ALG-003 edge cases #1–#9 + BUILT_UP specials.
 */

import { describe, it, expect } from 'vitest';
import { select_apa_panel } from '../algorithms/panels';
import { PanelSelectionFailed, SheathingSpecViolation } from '../errors';

describe('ALG-003 select_apa_panel — spec §6 edge cases', () => {
  // Row 1 — 24" spacing, 30 psf, with edge support → 32/16 (15/32)
  it('24" spacing, 30 psf, edge-support → 32/16 plywood (15/32)', () => {
    const panel = select_apa_panel(24, 30, 'asphalt_shingle', true);
    expect(panel.span_rating).toBe('32/16');
    expect(panel.thickness_in).toBeCloseTo(15 / 32, 5);
    expect(panel.material).toBe('plywood');
  });

  // Row 2 — 24" spacing, 40 psf, edge-support.
  // Spec row 2 says 24/16 (7/16") but that ignores the §2D floor
  // of 32/16 minimum for unsanded roof sheathing. Our algorithm
  // applies the floor, so 24/16 is filtered out and the first
  // qualifying row is 32/16 (15/32"). Flagged in the migration
  // report as a spec inconsistency — the thicker panel is safer
  // regardless.
  it('24" spacing, 40 psf, edge-support → 32/16 (floor enforced, 24/16 filtered)', () => {
    const panel = select_apa_panel(24, 40, 'asphalt_shingle', true);
    expect(panel.span_rating).toBe('32/16');
    expect(panel.thickness_in).toBeCloseTo(15 / 32, 5);
  });

  // Row 3 — 24" spacing, 41 psf → next higher, 32/16
  it('24" spacing, 41 psf, edge-support → 32/16 (bumps past 24/16)', () => {
    const panel = select_apa_panel(24, 41, 'asphalt_shingle', true);
    expect(panel.span_rating).toBe('32/16');
  });

  // Row 4 — 48" spacing, 35 psf → 60/32 (7/8)
  it('48" spacing, 35 psf, edge-support → 48/24 (35 psf at 48" is OK)', () => {
    const panel = select_apa_panel(48, 35, 'tile_clay', true);
    // 48/24 has live_loads_psf_by_spacing[48] = 35, so rated = required
    expect(panel.span_rating).toBe('48/24');
  });

  // Row 5 — 48" spacing, 100 psf → no panel qualifies
  it('48" spacing, 100 psf → PanelSelectionFailed', () => {
    expect(() =>
      select_apa_panel(48, 100, 'asphalt_shingle', true),
    ).toThrow(PanelSelectionFailed);
  });

  // Row 6 — 16" spacing, 180 psf → 32/16 (exact match on rated load)
  it('16" spacing, 180 psf, edge-support → 32/16 (exact match)', () => {
    const panel = select_apa_panel(16, 180, 'asphalt_shingle', true);
    expect(panel.span_rating).toBe('32/16');
  });

  // Row 7 — BUILT_UP with 24" spacing must have thickness ≥ 0.5"
  it('BUILT_UP, 24" spacing, 30 psf → thickness ≥ 0.5" (skips thinner panels)', () => {
    const panel = select_apa_panel(24, 30, 'built_up', true);
    expect(panel.thickness_in).toBeGreaterThanOrEqual(0.5);
  });

  // Row 8 — BUILT_UP + 28" spacing → SheathingSpecViolation
  it('BUILT_UP + 28" spacing → SheathingSpecViolation (rafters too wide for ½" ply)', () => {
    expect(() =>
      select_apa_panel(28, 30, 'built_up', true),
    ).toThrow(SheathingSpecViolation);
  });

  // Row 9 — 19.2" truss spacing → round up to 20" bin (next tabulated)
  it('19.2" truss spacing → bumped up to 20" bin (conservative)', () => {
    const panel = select_apa_panel(19.2, 30, 'asphalt_shingle', true);
    // At 20" bin with 30 psf, 24/0 and 24/16 are filtered by §2D
    // floor. 32/16 is the first qualifier (rated 120 psf at 20").
    expect(panel.span_rating).toBe('32/16');
  });

  it('19.2" truss spacing with flags → appends `truss_spacing_rounded_up` info flag (20" bin, not 24")', () => {
    // TABULATED_SPACINGS = [12, 16, 20, 24, 32, 40, 48, 60].
    // 19.2 → first bin ≥ 19.2 is 20, NOT 24. The panel selected
    // is still 32/16 because at 20" spacing + 30 psf the 32/16
    // row qualifies after the §2D floor filter (24/0 and 24/16
    // are skipped).
    const flags: import('../types').WarningFlag[] = [];
    select_apa_panel(19.2, 30, 'asphalt_shingle', true, { flags });
    const flag = flags.find((f) => f.code === 'truss_spacing_rounded_up');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('info');
    expect(flag?.message).toContain('19.2');
    expect(flag?.message).toContain('20');
  });

  it('tabulated 24" spacing → no truss flag even if flags array passed', () => {
    const flags: import('../types').WarningFlag[] = [];
    select_apa_panel(24, 30, 'asphalt_shingle', true, { flags });
    expect(flags.some((f) => f.code === 'truss_spacing_rounded_up')).toBe(false);
  });
});

describe('ALG-003 — allow_below_min_unsanded override', () => {
  it('24" spacing, 30 psf, with edge-support, default → 32/16 (floor enforced)', () => {
    const panel = select_apa_panel(24, 30, 'asphalt_shingle', true);
    expect(panel.span_rating).toBe('32/16');
  });

  it('same inputs, allow_below_min_unsanded=true → 24/0 (floor bypassed)', () => {
    const panel = select_apa_panel(24, 30, 'asphalt_shingle', true, {
      allow_below_min_unsanded: true,
    });
    // 24/0 has live_loads[24]=30, max_w_edge=24 → first qualifier
    expect(panel.span_rating).toBe('24/0');
    expect(panel.thickness_in).toBeCloseTo(3 / 8, 5);
  });

  it('allow_below_min_unsanded still enforces load + spacing constraints', () => {
    // Even with floor bypassed, 12/0 only supports 12" spacing.
    // At 24" spacing + 30 psf, 12/0 fails max_span check.
    const panel = select_apa_panel(24, 30, 'asphalt_shingle', true, {
      allow_below_min_unsanded: true,
    });
    expect(panel.span_rating).not.toBe('12/0');
  });
});

describe('ALG-003 — edge-support on/off', () => {
  it('24" spacing without edge support: 32/16 is still the first qualifier (floor)', () => {
    // 24/16 would qualify by load+span but is filtered by the
    // 32/16 floor. 32/16 max_wo_edge = 28, 28 ≥ 24 ✓, rated = 70 ≥ 40 ✓.
    const panel = select_apa_panel(24, 40, 'asphalt_shingle', false);
    expect(panel.span_rating).toBe('32/16');
  });

  it('32" spacing without edge support: 32/16 has max_wo_edge=28, rejects; 40/20 picks up', () => {
    // 32/16 max_wo_edge = 28 < 32 → rejected
    // 40/20 max_wo_edge = 32 → qualifies at 60 psf rated @ 32"
    const panel = select_apa_panel(32, 60, 'asphalt_shingle', false);
    expect(panel.span_rating).toBe('40/20');
  });
});
