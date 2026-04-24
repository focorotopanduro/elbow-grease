/**
 * §7 validate_job_inputs tests — spec gate that runs before the
 * cost engine (ALG-020).
 */

import { describe, it, expect } from 'vitest';
import { validate_job_inputs } from '../validation';
import {
  InvalidGeometry,
  MissingRequiredInput,
  UnknownCoveringType,
} from '../errors';
import type { Climate, CoveringType, Frame, JobInputs } from '../types';

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
    rate_set_version: 'FL-TEST-2026-Q2-v1',
    ...overrides,
  };
}

describe('§7 validate_job_inputs — geometry', () => {
  it('typical valid inputs → no throw', () => {
    expect(() => validate_job_inputs(make_inputs())).not.toThrow();
  });

  it('roof_area_sf = 0 → InvalidGeometry', () => {
    expect(() => validate_job_inputs(make_inputs({ roof_area_sf: 0 })))
      .toThrow(InvalidGeometry);
  });

  it('roof_area_sf negative → InvalidGeometry', () => {
    expect(() => validate_job_inputs(make_inputs({ roof_area_sf: -1 })))
      .toThrow(InvalidGeometry);
  });

  it('slope_rise_per_12 negative → InvalidGeometry', () => {
    expect(() => validate_job_inputs(make_inputs({ slope_rise_per_12: -1 })))
      .toThrow(InvalidGeometry);
  });

  it('slope_rise_per_12 = 0 (flat) → passes (flat is legal here; flag fires in ALG-001)', () => {
    expect(() => validate_job_inputs(make_inputs({ slope_rise_per_12: 0 })))
      .not.toThrow();
  });

  it('frame.rafter_spacing_in = 0 → InvalidGeometry', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({ frame: { ...FRAME, rafter_spacing_in: 0 } }),
      ),
    ).toThrow(InvalidGeometry);
  });

  it('frame.rafter_spacing_in negative → InvalidGeometry', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({ frame: { ...FRAME, rafter_spacing_in: -1 } }),
      ),
    ).toThrow(InvalidGeometry);
  });
});

describe('§7 validate_job_inputs — waste_factor', () => {
  it('waste_factor = 0 → passes', () => {
    expect(() => validate_job_inputs(make_inputs({ waste_factor: 0 }))).not.toThrow();
  });

  it('waste_factor = 0.999 → passes (just under upper bound)', () => {
    expect(() => validate_job_inputs(make_inputs({ waste_factor: 0.999 }))).not.toThrow();
  });

  it('waste_factor = 1.0 (boundary — must be < 1) → InvalidGeometry', () => {
    expect(() => validate_job_inputs(make_inputs({ waste_factor: 1.0 })))
      .toThrow(InvalidGeometry);
  });

  it('waste_factor negative → InvalidGeometry', () => {
    expect(() => validate_job_inputs(make_inputs({ waste_factor: -0.1 })))
      .toThrow(InvalidGeometry);
  });
});

describe('§7 validate_job_inputs — rate_set_version audit', () => {
  it('empty rate_set_version → MissingRequiredInput', () => {
    expect(() => validate_job_inputs(make_inputs({ rate_set_version: '' })))
      .toThrow(MissingRequiredInput);
  });
});

describe('§7 validate_job_inputs — covering enum', () => {
  it('unknown covering_type → UnknownCoveringType', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({
          covering: {
            covering_type: 'fake_future_covering' as unknown as CoveringType,
            weight_psf: 1,
          },
        }),
      ),
    ).toThrow(UnknownCoveringType);
  });

  it('negative weight_psf → InvalidGeometry', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({
          covering: { covering_type: 'asphalt_shingle', weight_psf: -0.5 },
        }),
      ),
    ).toThrow(InvalidGeometry);
  });

  it('weight_psf = 0 → passes (e.g. theoretical membrane)', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({
          covering: { covering_type: 'asphalt_shingle', weight_psf: 0 },
        }),
      ),
    ).not.toThrow();
  });
});

describe('§7 validate_job_inputs — reroof consistency', () => {
  it('is_reroof=true + existing_covering_weight_psf=undefined → MissingRequiredInput', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({ reroof: { is_reroof_over_existing: true } }),
      ),
    ).toThrow(MissingRequiredInput);
  });

  it('is_reroof=true + existing weight present → passes', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({
          reroof: {
            is_reroof_over_existing: true,
            existing_covering_weight_psf: 2.0,
          },
        }),
      ),
    ).not.toThrow();
  });

  it('is_reroof=false + no existing weight → passes (new construction path)', () => {
    expect(() =>
      validate_job_inputs(
        make_inputs({ reroof: { is_reroof_over_existing: false } }),
      ),
    ).not.toThrow();
  });
});
