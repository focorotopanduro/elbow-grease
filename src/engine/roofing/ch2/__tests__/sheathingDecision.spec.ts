/**
 * ALG-001 — `determine_sheathing_type` tests.
 *
 * Covers all 11 edge cases from spec §6 ALG-001. Each block cites
 * the spec row (# in the edge-case table).
 */

import { describe, it, expect } from 'vitest';
import { determine_sheathing_type } from '../algorithms/sheathingDecision';
import { InvalidGeometry } from '../errors';
import type {
  Climate,
  CoveringType,
  Frame,
  JobInputs,
  WarningFlag,
} from '../types';

// ── Fixtures ───────────────────────────────────────────────────

const DEFAULT_CLIMATE: Climate = {
  humidity: 'normal',
  cold_design_temp_f: 40,
  january_mean_temp_f: 50,
  ice_risk_at_eaves: false,
  wind_driven_rain_zone: false,
  seismic_zone: false,
};

const DEFAULT_FRAME: Frame = {
  frame_type: 'truss',
  rafter_spacing_in: 24,
  has_open_cornice_gable: false,
  has_vented_attic: true,
};

function make_inputs(overrides: {
  covering?: CoveringType;
  slope?: number;
  area?: number;
  climate?: Partial<Climate>;
  frame?: Partial<Frame>;
} = {}): JobInputs {
  const climate: Climate = { ...DEFAULT_CLIMATE, ...overrides.climate };
  const frame: Frame = { ...DEFAULT_FRAME, ...overrides.frame };
  return {
    roof_area_sf: overrides.area ?? 2400,
    roof_shape: 'gable',
    slope_rise_per_12: overrides.slope ?? 6,
    frame,
    covering: {
      covering_type: overrides.covering ?? 'asphalt_shingle',
      weight_psf: 2.0,
    },
    reroof: { is_reroof_over_existing: false },
    climate,
    waste_factor: 0.1,
    rate_set_version: 'FL-2026-Q2-v1',
  };
}

// ── Edge-case rows from spec §6 ALG-001 ────────────────────────

describe('ALG-001 determine_sheathing_type — spec §6 edge cases', () => {
  // Row 1
  it('asphalt shingle (any climate) → solid', () => {
    const flags: WarningFlag[] = [];
    expect(determine_sheathing_type(make_inputs({ covering: 'asphalt_shingle' }), flags))
      .toBe('solid');
  });

  // Row 2
  it('wood shake at exactly 4:12 slope → spaced_with_solid_zones (4 is NOT less than 4)', () => {
    const flags: WarningFlag[] = [];
    expect(
      determine_sheathing_type(
        make_inputs({ covering: 'wood_shake', slope: 4.0 }),
        flags,
      ),
    ).toBe('spaced_with_solid_zones');
  });

  // Row 3
  it('wood shake at 3.99:12 slope → spaced_over_solid_hybrid', () => {
    const flags: WarningFlag[] = [];
    expect(
      determine_sheathing_type(
        make_inputs({ covering: 'wood_shake', slope: 3.99 }),
        flags,
      ),
    ).toBe('spaced_over_solid_hybrid');
  });

  // Row 4
  it('wood shake with cold_design_temp_f = 0 (boundary, ≤) → solid', () => {
    const flags: WarningFlag[] = [];
    expect(
      determine_sheathing_type(
        make_inputs({
          covering: 'wood_shake',
          climate: { cold_design_temp_f: 0 },
        }),
        flags,
      ),
    ).toBe('solid');
  });

  // Row 5
  it('wood shake with cold_design_temp_f = 1 → non-solid path evaluated', () => {
    const flags: WarningFlag[] = [];
    // Slope 6:12, Jan mean 50, no ice risk → default wood path
    expect(
      determine_sheathing_type(
        make_inputs({
          covering: 'wood_shake',
          slope: 6,
          climate: { cold_design_temp_f: 1 },
        }),
        flags,
      ),
    ).toBe('spaced_with_solid_zones');
  });

  // Row 6 — FL wind-rain zone + wood shake + 6:12
  it('wood shake FL wind-rain + 6:12 → spaced_with_solid_zones + wind_rain flag', () => {
    const flags: WarningFlag[] = [];
    const result = determine_sheathing_type(
      make_inputs({
        covering: 'wood_shake',
        slope: 6,
        climate: { wind_driven_rain_zone: true, humidity: 'high' },
      }),
      flags,
    );
    expect(result).toBe('spaced_with_solid_zones');
    expect(flags.some((f) => f.code === 'wind_rain_zone_solid_recommended')).toBe(true);
  });

  // Row 7
  it('corrugated metal → solid + info flag', () => {
    const flags: WarningFlag[] = [];
    const result = determine_sheathing_type(
      make_inputs({ covering: 'metal_corrugated' }),
      flags,
    );
    expect(result).toBe('solid');
    expect(
      flags.some((f) => f.code === 'metal_corrugated_spaced_allowed_by_local_code'),
    ).toBe(true);
    expect(flags.find((f) => f.code === 'metal_corrugated_spaced_allowed_by_local_code')
      ?.severity).toBe('info');
  });

  // Row 8 — Seismic short-circuit
  it('seismic + wood shake + cold → solid (seismic short-circuits all other rules)', () => {
    const flags: WarningFlag[] = [];
    const result = determine_sheathing_type(
      make_inputs({
        covering: 'wood_shake',
        slope: 6,
        climate: {
          seismic_zone: true,
          cold_design_temp_f: -10,
          january_mean_temp_f: 10,
          ice_risk_at_eaves: true,
        },
      }),
      flags,
    );
    expect(result).toBe('solid');
    // No flags appended — seismic returns immediately before the
    // cold / wind-rain branches get a chance to fire.
    expect(flags).toHaveLength(0);
  });

  // Row 9
  it('slope 0 with asphalt shingle → solid + flat_slope flag', () => {
    const flags: WarningFlag[] = [];
    const result = determine_sheathing_type(
      make_inputs({ covering: 'asphalt_shingle', slope: 0 }),
      flags,
    );
    expect(result).toBe('solid');
    expect(flags.some((f) => f.code === 'flat_slope_review_ch10')).toBe(true);
  });

  // Row 10
  it('slope -1 → raises InvalidGeometry', () => {
    expect(() =>
      determine_sheathing_type(make_inputs({ slope: -1 }), []),
    ).toThrow(InvalidGeometry);
  });

  // Row 11 — covered by TS's exhaustive union type at compile time,
  // but we can still assert that an unexpected runtime value throws.
  it('unknown covering type (runtime cast) → raises UnknownCoveringType', () => {
    const inputs = make_inputs();
    // Force-cast a fake covering to simulate a runtime-only extension
    // that forgot to update the switch.
    const evilInputs: JobInputs = {
      ...inputs,
      covering: {
        ...inputs.covering,
        covering_type: 'fake_future_covering' as unknown as CoveringType,
      },
    };
    expect(() => determine_sheathing_type(evilInputs, [])).toThrow();
  });
});

// ── Additional invariants not in the spec but worth pinning ────

describe('ALG-001 — invariant checks', () => {
  it('roof_area_sf = 0 → InvalidGeometry (spec §6 step 1 secondary)', () => {
    expect(() =>
      determine_sheathing_type(make_inputs({ area: 0 }), []),
    ).toThrow(InvalidGeometry);
  });

  it('roof_area_sf negative → InvalidGeometry', () => {
    expect(() =>
      determine_sheathing_type(make_inputs({ area: -1 }), []),
    ).toThrow(InvalidGeometry);
  });

  it('returned value is always one of the three SheathingType literals', () => {
    const cases: { input: Partial<Parameters<typeof make_inputs>[0]>; expected: string }[] = [
      { input: { covering: 'asphalt_shingle' }, expected: 'solid' },
      { input: { covering: 'tile_clay' }, expected: 'solid' },
      { input: { covering: 'wood_shake', slope: 6 }, expected: 'spaced_with_solid_zones' },
      { input: { covering: 'wood_shingle', slope: 3 }, expected: 'spaced_over_solid_hybrid' },
    ];
    for (const c of cases) {
      expect(determine_sheathing_type(make_inputs(c.input), [])).toBe(c.expected);
    }
  });

  it('seismic + any covering → solid, no flags', () => {
    const flags: WarningFlag[] = [];
    const coverings: CoveringType[] = [
      'asphalt_shingle',
      'wood_shake',
      'tile_clay',
      'metal_corrugated',
      'slate',
    ];
    for (const covering of coverings) {
      flags.length = 0;
      const result = determine_sheathing_type(
        make_inputs({ covering, climate: { seismic_zone: true } }),
        flags,
      );
      expect(result).toBe('solid');
      expect(flags).toHaveLength(0);
    }
  });
});
