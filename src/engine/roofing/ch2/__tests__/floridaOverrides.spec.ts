/**
 * Florida overrides tests — spec §9.4.
 *
 * Covers both entry points:
 *   - is_fl_job / is_hvhz_job detection helpers
 *   - apply_florida_sheathing_type_override (pre-process)
 *   - apply_florida_bid_audit_flags (post-process)
 *
 * Plus end-to-end through price_sheathing_bid to confirm the
 * orchestrator integrates both correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  apply_florida_bid_audit_flags,
  apply_florida_sheathing_type_override,
  is_fl_job,
  is_hvhz_job,
} from '../floridaOverrides';
import { price_sheathing_bid } from '../costing/costEngine';
import { TEST_RATE_SET_FL_2026_Q2_V1 } from '../rateSet';
import type {
  BidOutput,
  Climate,
  Frame,
  JobInputs,
  SheathingType,
  WarningFlag,
} from '../types';

// ── Fixtures ───────────────────────────────────────────────────

const NON_FL_CLIMATE: Climate = {
  humidity: 'normal',
  cold_design_temp_f: 40,
  january_mean_temp_f: 50,
  ice_risk_at_eaves: false,
  wind_driven_rain_zone: false,
  seismic_zone: false,
};

const FL_NON_HVHZ: Climate = {
  ...NON_FL_CLIMATE,
  humidity: 'high',
  wind_driven_rain_zone: true,
  jurisdiction: 'fl_non_hvhz',
};

const FL_HVHZ: Climate = {
  ...NON_FL_CLIMATE,
  humidity: 'high',
  wind_driven_rain_zone: true,
  jurisdiction: 'fl_hvhz',
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
    climate: NON_FL_CLIMATE,
    waste_factor: 0.1,
    rate_set_version: TEST_RATE_SET_FL_2026_Q2_V1.version,
    ...overrides,
  };
}

// ── Detection helpers ─────────────────────────────────────────

describe('is_fl_job', () => {
  it('jurisdiction=fl_hvhz → true', () => {
    expect(is_fl_job(FL_HVHZ)).toBe(true);
  });

  it('jurisdiction=fl_non_hvhz → true', () => {
    expect(is_fl_job(FL_NON_HVHZ)).toBe(true);
  });

  it('jurisdiction=other → false (regardless of wind_driven_rain_zone)', () => {
    const c: Climate = { ...NON_FL_CLIMATE, jurisdiction: 'other', wind_driven_rain_zone: true };
    expect(is_fl_job(c)).toBe(false);
  });

  it('jurisdiction undefined + wind_driven_rain_zone=true → true (legacy proxy)', () => {
    const c: Climate = { ...NON_FL_CLIMATE, wind_driven_rain_zone: true };
    expect(is_fl_job(c)).toBe(true);
  });

  it('jurisdiction undefined + wind_driven_rain_zone=false → false', () => {
    expect(is_fl_job(NON_FL_CLIMATE)).toBe(false);
  });
});

describe('is_hvhz_job', () => {
  it('jurisdiction=fl_hvhz → true', () => {
    expect(is_hvhz_job(FL_HVHZ)).toBe(true);
  });

  it('jurisdiction=fl_non_hvhz → false (FL but not HVHZ)', () => {
    expect(is_hvhz_job(FL_NON_HVHZ)).toBe(false);
  });

  it('jurisdiction undefined + wind_driven_rain=true → false (no HVHZ proxy)', () => {
    const c: Climate = { ...NON_FL_CLIMATE, wind_driven_rain_zone: true };
    expect(is_hvhz_job(c)).toBe(false);
  });

  it('non-FL → false', () => {
    expect(is_hvhz_job(NON_FL_CLIMATE)).toBe(false);
  });
});

// ── Sheathing-type pre-process ────────────────────────────────

describe('apply_florida_sheathing_type_override', () => {
  it('non-FL job + spaced sheathing → passthrough (no change)', () => {
    const flags: WarningFlag[] = [];
    const inputs = make_inputs({ covering: { covering_type: 'wood_shake', weight_psf: 3.0 } });
    const out = apply_florida_sheathing_type_override(
      inputs,
      'spaced_with_solid_zones',
      flags,
    );
    expect(out).toBe('spaced_with_solid_zones');
    expect(flags).toHaveLength(0);
  });

  it('FL job + already-solid → passthrough (nothing to override)', () => {
    const flags: WarningFlag[] = [];
    const inputs = make_inputs({
      climate: FL_HVHZ,
      covering: { covering_type: 'asphalt_shingle', weight_psf: 2.0 },
    });
    const out = apply_florida_sheathing_type_override(inputs, 'solid', flags);
    expect(out).toBe('solid');
    expect(flags).toHaveLength(0);
  });

  it('FL job + non-wood covering + spaced (impossible per spec) → passthrough', () => {
    // Defensive: non-wood + spaced shouldn't occur in practice (ALG-001
    // always returns solid for non-wood coverings) but if some caller
    // sends that combination, FL override doesn't touch it.
    const flags: WarningFlag[] = [];
    const inputs = make_inputs({
      climate: FL_HVHZ,
      covering: { covering_type: 'asphalt_shingle', weight_psf: 2.0 },
    });
    const out = apply_florida_sheathing_type_override(
      inputs,
      'spaced_with_solid_zones' as SheathingType,
      flags,
    );
    expect(out).toBe('spaced_with_solid_zones');
  });

  it('FL job + wood_shake + spaced → SOLID + audit flag', () => {
    const flags: WarningFlag[] = [];
    const inputs = make_inputs({
      climate: FL_NON_HVHZ,
      covering: { covering_type: 'wood_shake', weight_psf: 3.0 },
    });
    const out = apply_florida_sheathing_type_override(
      inputs,
      'spaced_with_solid_zones',
      flags,
    );
    expect(out).toBe('solid');
    const flag = flags.find((f) => f.code === 'fl_override_forced_solid');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('info');
    expect(flag?.message).toContain('wood_shake');
  });

  it('FL HVHZ job + wood_shingle + spaced_over_solid_hybrid → SOLID + audit flag', () => {
    const flags: WarningFlag[] = [];
    const inputs = make_inputs({
      climate: FL_HVHZ,
      covering: { covering_type: 'wood_shingle', weight_psf: 2.0 },
      slope_rise_per_12: 3,
    });
    const out = apply_florida_sheathing_type_override(
      inputs,
      'spaced_over_solid_hybrid',
      flags,
    );
    expect(out).toBe('solid');
    expect(flags.some((f) => f.code === 'fl_override_forced_solid')).toBe(true);
  });
});

// ── Audit-flag post-process ───────────────────────────────────

describe('apply_florida_bid_audit_flags', () => {
  const base_bid: BidOutput = {
    sheathing_spec: {
      sheathing_type: 'solid',
      panel: null,
      board_width_nominal_in: null,
      board_profile: null,
      edge_support: null,
      fasteners: {
        mode: 'nail',
        nail_type: 'ring_shank_8d',
        staple_gauge: null,
        staple_crown_in: null,
        staple_length_in: null,
        edge_oc_in: 6,
        field_oc_in: 12,
      },
      gaps: null,
      solid_zones: null,
    },
    materials: [],
    labor: [],
    adders: [],
    subtotal_usd: 1000,
    total_usd: 1070,
    flags: [],
    staging_instruction: '',
    rate_set_version: TEST_RATE_SET_FL_2026_Q2_V1.version,
    priced_on: '2026-04-23',
  };

  it('non-FL job → bid unchanged (identity-ish, no new flags)', () => {
    const out = apply_florida_bid_audit_flags(make_inputs(), base_bid);
    expect(out.flags).toHaveLength(0);
    expect(out.subtotal_usd).toBe(1000);
  });

  it('FL non-HVHZ → appends fl_overrides_applied (info) but NOT hvhz flag', () => {
    const out = apply_florida_bid_audit_flags(
      make_inputs({ climate: FL_NON_HVHZ }),
      base_bid,
    );
    expect(out.flags.some((f) => f.code === 'fl_overrides_applied')).toBe(true);
    expect(out.flags.some((f) => f.code === 'hvhz_fastener_schedule_verify')).toBe(false);
  });

  it('FL HVHZ → both fl_overrides_applied AND hvhz_fastener_schedule_verify', () => {
    const out = apply_florida_bid_audit_flags(
      make_inputs({ climate: FL_HVHZ }),
      base_bid,
    );
    const codes = out.flags.map((f) => f.code);
    expect(codes).toContain('fl_overrides_applied');
    expect(codes).toContain('hvhz_fastener_schedule_verify');
  });

  it('post-process preserves existing flags (append, don\'t replace)', () => {
    const bid_with_flags: BidOutput = {
      ...base_bid,
      flags: [
        { code: 'existing_flag', severity: 'warning', message: 'pre-existing' },
      ],
    };
    const out = apply_florida_bid_audit_flags(
      make_inputs({ climate: FL_HVHZ }),
      bid_with_flags,
    );
    expect(out.flags.some((f) => f.code === 'existing_flag')).toBe(true);
    expect(out.flags.some((f) => f.code === 'fl_overrides_applied')).toBe(true);
  });

  it('post-process does NOT modify numbers (prices preserved)', () => {
    const out = apply_florida_bid_audit_flags(
      make_inputs({ climate: FL_HVHZ }),
      base_bid,
    );
    expect(out.subtotal_usd).toBe(1000);
    expect(out.total_usd).toBe(1070);
  });

  it('returned BidOutput is a NEW object (input not mutated)', () => {
    const out = apply_florida_bid_audit_flags(
      make_inputs({ climate: FL_HVHZ }),
      base_bid,
    );
    expect(out).not.toBe(base_bid);
    expect(base_bid.flags).toHaveLength(0); // input untouched
  });

  it('HVHZ flag message mentions "FBC" + "panel-edge spacing"', () => {
    const out = apply_florida_bid_audit_flags(
      make_inputs({ climate: FL_HVHZ }),
      base_bid,
    );
    const hvhz_flag = out.flags.find((f) => f.code === 'hvhz_fastener_schedule_verify');
    expect(hvhz_flag?.message).toMatch(/FBC/);
    expect(hvhz_flag?.message.toLowerCase()).toMatch(/panel.edge/);
  });
});

// ── End-to-end through orchestrator ───────────────────────────

describe('ALG-020 orchestrator — FL override integration', () => {
  it('FL HVHZ asphalt bid → BidOutput includes both FL audit flags', () => {
    const bid = price_sheathing_bid(
      make_inputs({ climate: FL_HVHZ }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    const codes = bid.flags.map((f) => f.code);
    expect(codes).toContain('fl_overrides_applied');
    expect(codes).toContain('hvhz_fastener_schedule_verify');
  });

  it('FL wood_shake bid → sheathing_type flipped to solid + fl_override flag', () => {
    // Non-plywood path, so cost lines are empty but sheathing_type
    // AND audit flags still flow through.
    const bid = price_sheathing_bid(
      make_inputs({
        climate: FL_NON_HVHZ,
        covering: { covering_type: 'wood_shake', weight_psf: 3.0 },
        slope_rise_per_12: 6,
      }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.sheathing_spec.sheathing_type).toBe('solid');
    expect(bid.flags.some((f) => f.code === 'fl_override_forced_solid')).toBe(true);
    expect(bid.flags.some((f) => f.code === 'fl_overrides_applied')).toBe(true);
  });

  it('non-FL bid → no FL flags in output', () => {
    const bid = price_sheathing_bid(make_inputs(), TEST_RATE_SET_FL_2026_Q2_V1);
    const fl_codes = ['fl_overrides_applied', 'hvhz_fastener_schedule_verify', 'fl_override_forced_solid'];
    for (const code of fl_codes) {
      expect(bid.flags.some((f) => f.code === code)).toBe(false);
    }
  });

  it('jurisdiction=other + wind_driven_rain=true → no FL overrides (explicit other wins)', () => {
    // User explicitly sets jurisdiction='other' even though
    // wind_driven_rain_zone=true — the jurisdiction takes priority.
    const bid = price_sheathing_bid(
      make_inputs({
        climate: { ...NON_FL_CLIMATE, wind_driven_rain_zone: true, jurisdiction: 'other' },
      }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.flags.some((f) => f.code === 'fl_overrides_applied')).toBe(false);
  });

  it('legacy proxy: wind_driven_rain=true + no jurisdiction → FL overrides apply', () => {
    const bid = price_sheathing_bid(
      make_inputs({ climate: { ...NON_FL_CLIMATE, wind_driven_rain_zone: true } }),
      TEST_RATE_SET_FL_2026_Q2_V1,
    );
    expect(bid.flags.some((f) => f.code === 'fl_overrides_applied')).toBe(true);
    // But no HVHZ flag — legacy proxy doesn't upgrade to HVHZ
    expect(bid.flags.some((f) => f.code === 'hvhz_fastener_schedule_verify')).toBe(false);
  });
});
