/**
 * ALG-020 — `price_sheathing_bid` integration tests.
 *
 * End-to-end smoke test for the SOLID + plywood canonical path
 * plus non-plywood fallback flag behaviour.
 */

import { describe, it, expect } from 'vitest';
import { price_sheathing_bid } from '../costing/costEngine';
import { TEST_RATE_SET_FL_2026_Q2_V1 } from '../rateSet';
import {
  InvalidGeometry,
  MissingRequiredInput,
  UnknownCoveringType,
} from '../errors';
import type {
  Climate,
  CoveringType,
  Frame,
  JobInputs,
  RateSet,
} from '../types';

const CLIMATE: Climate = {
  humidity: 'normal',
  cold_design_temp_f: 40,
  january_mean_temp_f: 50,
  ice_risk_at_eaves: false,
  wind_driven_rain_zone: false,
  seismic_zone: false,
};

const FRAME: Frame = {
  frame_type: 'truss',
  rafter_spacing_in: 24,
  has_open_cornice_gable: false,
  has_vented_attic: true,
};

function make_inputs(overrides: Partial<JobInputs> = {}): JobInputs {
  return {
    roof_area_sf: 2400,
    roof_shape: 'gable',
    slope_rise_per_12: 6,
    frame: FRAME,
    covering: { covering_type: 'asphalt_shingle', weight_psf: 2.0 },
    reroof: { is_reroof_over_existing: false },
    climate: CLIMATE,
    waste_factor: 0.1,
    rate_set_version: TEST_RATE_SET_FL_2026_Q2_V1.version,
    ...overrides,
  };
}

// ── Happy path ─────────────────────────────────────────────────

describe('ALG-020 — SOLID + plywood happy path', () => {
  it('typical asphalt shingle bid produces fully-priced BidOutput', () => {
    const bid = price_sheathing_bid(make_inputs(), TEST_RATE_SET_FL_2026_Q2_V1);

    // Shape
    expect(bid.sheathing_spec.sheathing_type).toBe('solid');
    expect(bid.sheathing_spec.panel).not.toBeNull();
    expect(bid.sheathing_spec.panel?.material).toBe('plywood');
    expect(bid.sheathing_spec.panel?.span_rating).toBe('32/16');
    expect(bid.sheathing_spec.fasteners.mode).toBe('nail');
    expect(bid.sheathing_spec.gaps).not.toBeNull();
    expect(bid.sheathing_spec.solid_zones).toBeNull();

    // Cost lines populated
    expect(bid.materials.length).toBeGreaterThan(0);
    expect(bid.labor.length).toBe(1);

    // Totals consistent
    const material_total = bid.materials.reduce((s, l) => s + l.extended_usd, 0);
    const labor_total = bid.labor.reduce((s, l) => s + l.extended_usd, 0);
    expect(bid.subtotal_usd).toBeCloseTo(material_total + labor_total, 4);
    expect(bid.total_usd).toBeCloseTo(
      bid.subtotal_usd * (1 + TEST_RATE_SET_FL_2026_Q2_V1.tax_rate),
      4,
    );

    // Audit trail
    expect(bid.rate_set_version).toBe(TEST_RATE_SET_FL_2026_Q2_V1.version);
    expect(bid.priced_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('humid climate → panel gaps doubled (FL HVHZ case)', () => {
    const humid_inputs = make_inputs({
      climate: { ...CLIMATE, humidity: 'high', wind_driven_rain_zone: true },
    });
    const bid = price_sheathing_bid(humid_inputs, TEST_RATE_SET_FL_2026_Q2_V1);
    expect(bid.sheathing_spec.gaps?.end_gap_in).toBeCloseTo(1 / 8, 6);
    expect(bid.sheathing_spec.gaps?.side_gap_in).toBeCloseTo(1 / 4, 6);
  });

  it('HVHZ zone → ring-shank nails (ALG-008 default for wind_driven_rain=true)', () => {
    const hvhz = make_inputs({
      climate: { ...CLIMATE, humidity: 'high', wind_driven_rain_zone: true },
    });
    const bid = price_sheathing_bid(hvhz, TEST_RATE_SET_FL_2026_Q2_V1);
    expect(bid.sheathing_spec.fasteners.nail_type).toBe('ring_shank_8d');
  });

  it('non-HVHZ → common nails (no ring-shank preference)', () => {
    const bid = price_sheathing_bid(
      make_inputs({ climate: { ...CLIMATE, wind_driven_rain_zone: false } }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    // 15/32" panel at ≤ 0.5 breakpoint, prefer_ring=false → common_6d
    expect(bid.sheathing_spec.fasteners.nail_type).toBe('common_6d');
  });
});

// ── Validation gate throws propagate ────────────────────────────

describe('ALG-020 — §7 validation gate throws propagate', () => {
  it('roof_area_sf = 0 → InvalidGeometry', () => {
    expect(() =>
      price_sheathing_bid(
        make_inputs({ roof_area_sf: 0 }),
        TEST_RATE_SET_FL_2026_Q2_V1,
      ),
    ).toThrow(InvalidGeometry);
  });

  it('negative slope → InvalidGeometry', () => {
    expect(() =>
      price_sheathing_bid(
        make_inputs({ slope_rise_per_12: -1 }),
        TEST_RATE_SET_FL_2026_Q2_V1,
      ),
    ).toThrow(InvalidGeometry);
  });

  it('empty rate_set_version → MissingRequiredInput', () => {
    expect(() =>
      price_sheathing_bid(
        make_inputs({ rate_set_version: '' }),
        TEST_RATE_SET_FL_2026_Q2_V1,
      ),
    ).toThrow(MissingRequiredInput);
  });

  it('unknown covering → UnknownCoveringType', () => {
    expect(() =>
      price_sheathing_bid(
        make_inputs({
          covering: {
            covering_type: 'fake_covering' as unknown as CoveringType,
            weight_psf: 1,
          },
        }),
        TEST_RATE_SET_FL_2026_Q2_V1,
      ),
    ).toThrow(UnknownCoveringType);
  });

  it('reroof without existing weight → MissingRequiredInput', () => {
    expect(() =>
      price_sheathing_bid(
        make_inputs({ reroof: { is_reroof_over_existing: true } }),
        TEST_RATE_SET_FL_2026_Q2_V1,
      ),
    ).toThrow(MissingRequiredInput);
  });
});

// ── Flags bubbling ──────────────────────────────────────────────

describe('ALG-020 — warning flags surface correctly', () => {
  it('reroof with heavier covering → frame_load_check_required flag', () => {
    const bid = price_sheathing_bid(
      make_inputs({
        reroof: {
          is_reroof_over_existing: true,
          existing_covering_weight_psf: 0.9,
        },
        // asphalt 2.0 psf > existing 0.9 → heavier, fire flag
      }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.flags.some((f) => f.code === 'frame_load_check_required')).toBe(true);
  });

  it('solid + unvented attic → ventilation_insufficient flag', () => {
    const bid = price_sheathing_bid(
      make_inputs({ frame: { ...FRAME, has_vented_attic: false } }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.flags.some((f) => f.code === 'ventilation_insufficient')).toBe(true);
  });

  it('rate_set.version mismatch inputs.rate_set_version → flag', () => {
    const bid = price_sheathing_bid(
      make_inputs({ rate_set_version: 'FL-OLD-2024-v1' }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.flags.some((f) => f.code === 'rate_set_version_mismatch')).toBe(true);
  });

  it('stale rate set → rate_set_stale flag', () => {
    const stale: RateSet = {
      ...TEST_RATE_SET_FL_2026_Q2_V1,
      last_verified_date: '2020-01-01',
    };
    const bid = price_sheathing_bid(make_inputs({ rate_set_version: stale.version }), stale);
    expect(bid.flags.some((f) => f.code === 'rate_set_stale')).toBe(true);
  });
});

// ── Non-plywood path fallback ───────────────────────────────────

describe('ALG-020 — non-plywood paths emit placeholder flag', () => {
  it('wood_shake (spaced_with_solid_zones) → sheathing_path_not_yet_costed flag', () => {
    const bid = price_sheathing_bid(
      make_inputs({
        covering: { covering_type: 'wood_shake', weight_psf: 3.0 },
        slope_rise_per_12: 6,
      }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.flags.some((f) => f.code === 'sheathing_path_not_yet_costed')).toBe(true);
    expect(bid.materials).toHaveLength(0);
    expect(bid.labor).toHaveLength(0);
    expect(bid.subtotal_usd).toBe(0);
    expect(bid.total_usd).toBe(0);
  });

  it('sheathing_material_pref=osb → path not yet costed', () => {
    const bid = price_sheathing_bid(
      make_inputs({ sheathing_material_pref: 'osb' }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.flags.some((f) => f.code === 'sheathing_path_not_yet_costed')).toBe(true);
  });
});

// ── Staging instruction ─────────────────────────────────────────

describe('ALG-020 — staging_instruction', () => {
  it('non-tile covering → generic install instruction', () => {
    const bid = price_sheathing_bid(make_inputs(), TEST_RATE_SET_FL_2026_Q2_V1);
    expect(bid.staging_instruction).toMatch(/§2D/);
  });

  it('tile covering → gable staging rules concatenated', () => {
    const bid = price_sheathing_bid(
      make_inputs({
        covering: { covering_type: 'tile_clay', weight_psf: 16.0 },
      }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.staging_instruction.toLowerCase()).toMatch(/ridge|4th course/);
  });

  it('hip tile → staging includes hip general rules + fires review-needed flag', () => {
    const bid = price_sheathing_bid(
      make_inputs({
        covering: { covering_type: 'tile_clay', weight_psf: 16.0 },
        roof_shape: 'hip',
      }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.staging_instruction.toLowerCase()).toMatch(/narrows/);
    expect(bid.flags.some((f) => f.code === 'hip_tile_loading_review_needed')).toBe(true);
  });
});
