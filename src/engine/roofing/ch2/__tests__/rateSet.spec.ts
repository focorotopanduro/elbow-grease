/**
 * RateSet loader + validator + staleness-check tests.
 *
 * Covers every validation rule, JSON parse failure modes, the
 * staleness boundary, and asserts the test seed's integrity.
 */

import { describe, it, expect } from 'vitest';
import {
  RATE_SET_STALENESS_DAYS,
  TEST_RATE_SET_FL_2026_Q2_V1,
  check_rate_set_staleness,
  load_rate_set,
  validate_rate_set,
} from '../rateSet';
import { RateSetMissing } from '../errors';
import type { RateSet } from '../types';

// ── Reusable valid base ────────────────────────────────────────

function valid_seed(): Record<string, unknown> {
  // Deep-cloned mutable copy so tests can tweak fields without
  // polluting each other.
  return JSON.parse(JSON.stringify(TEST_RATE_SET_FL_2026_Q2_V1));
}

describe('validate_rate_set — structural validation', () => {
  it('accepts the canonical TEST seed', () => {
    expect(() => validate_rate_set(TEST_RATE_SET_FL_2026_Q2_V1)).not.toThrow();
  });

  // Null / undefined / primitive inputs
  it('null → RateSetMissing', () => {
    expect(() => validate_rate_set(null)).toThrow(RateSetMissing);
  });

  it('undefined → RateSetMissing', () => {
    expect(() => validate_rate_set(undefined)).toThrow(RateSetMissing);
  });

  it('string input (non-object) → RateSetMissing', () => {
    expect(() => validate_rate_set('not-an-object')).toThrow(RateSetMissing);
  });

  it('number input → RateSetMissing', () => {
    expect(() => validate_rate_set(42)).toThrow(RateSetMissing);
  });

  // version
  it('missing version → RateSetMissing', () => {
    const r = valid_seed();
    delete r.version;
    expect(() => validate_rate_set(r)).toThrow(/version/);
  });

  it('empty version → RateSetMissing', () => {
    const r = valid_seed();
    r.version = '';
    expect(() => validate_rate_set(r)).toThrow(/version/);
  });

  it('non-string version → RateSetMissing', () => {
    const r = valid_seed();
    r.version = 123;
    expect(() => validate_rate_set(r)).toThrow(/version/);
  });

  // source
  it('non-string source → RateSetMissing', () => {
    const r = valid_seed();
    r.source = null;
    expect(() => validate_rate_set(r)).toThrow(/source/);
  });

  // crew_manhour_rate_usd
  it('crew_manhour_rate_usd = 0 → RateSetMissing', () => {
    const r = valid_seed();
    r.crew_manhour_rate_usd = 0;
    expect(() => validate_rate_set(r)).toThrow(/crew_manhour_rate_usd/);
  });

  it('crew_manhour_rate_usd = negative → RateSetMissing', () => {
    const r = valid_seed();
    r.crew_manhour_rate_usd = -10;
    expect(() => validate_rate_set(r)).toThrow(/crew_manhour_rate_usd/);
  });

  it('crew_manhour_rate_usd = NaN → RateSetMissing', () => {
    const r = valid_seed();
    r.crew_manhour_rate_usd = Number.NaN;
    expect(() => validate_rate_set(r)).toThrow(/crew_manhour_rate_usd/);
  });

  it('crew_manhour_rate_usd = Infinity → RateSetMissing', () => {
    const r = valid_seed();
    r.crew_manhour_rate_usd = Number.POSITIVE_INFINITY;
    expect(() => validate_rate_set(r)).toThrow(/crew_manhour_rate_usd/);
  });

  // labor_rates_mh_per_sf
  it('labor_rates_mh_per_sf missing → RateSetMissing', () => {
    const r = valid_seed();
    delete r.labor_rates_mh_per_sf;
    expect(() => validate_rate_set(r)).toThrow(/labor_rates_mh_per_sf/);
  });

  it('labor_rates_mh_per_sf with negative value → RateSetMissing', () => {
    const r = valid_seed();
    r.labor_rates_mh_per_sf = { board_sheathing: -0.01 };
    expect(() => validate_rate_set(r)).toThrow(/labor_rates_mh_per_sf/);
  });

  it('labor_rates_mh_per_sf with 0 value → RateSetMissing (labor rate must be > 0)', () => {
    const r = valid_seed();
    r.labor_rates_mh_per_sf = { board_sheathing: 0 };
    expect(() => validate_rate_set(r)).toThrow(/labor_rates_mh_per_sf/);
  });

  it('labor_rates_mh_per_sf with non-number value → RateSetMissing', () => {
    const r = valid_seed();
    r.labor_rates_mh_per_sf = { board_sheathing: '0.026' };
    expect(() => validate_rate_set(r)).toThrow(/labor_rates_mh_per_sf/);
  });

  it('labor_rates_mh_per_sf empty object → no throw (some rate sets are material-only)', () => {
    const r = valid_seed();
    r.labor_rates_mh_per_sf = {};
    expect(() => validate_rate_set(r)).not.toThrow();
  });

  // material_skus_usd_per_sf
  it('material_skus_usd_per_sf with negative value → RateSetMissing', () => {
    const r = valid_seed();
    r.material_skus_usd_per_sf = { plywood_32_16_15_32: -0.5 };
    expect(() => validate_rate_set(r)).toThrow(/material_skus_usd_per_sf/);
  });

  it('material_skus_usd_per_sf with 0 value → no throw (bundled items are allowed)', () => {
    const r = valid_seed();
    r.material_skus_usd_per_sf = { bundled_item: 0 };
    expect(() => validate_rate_set(r)).not.toThrow();
  });

  it('material_skus_usd_per_sf empty object → no throw', () => {
    const r = valid_seed();
    r.material_skus_usd_per_sf = {};
    expect(() => validate_rate_set(r)).not.toThrow();
  });

  // tax_rate
  it('tax_rate = 0 → no throw (bid may be tax-exempt)', () => {
    const r = valid_seed();
    r.tax_rate = 0;
    expect(() => validate_rate_set(r)).not.toThrow();
  });

  it('tax_rate = 1 → no throw (100% tax — silly but within range)', () => {
    const r = valid_seed();
    r.tax_rate = 1;
    expect(() => validate_rate_set(r)).not.toThrow();
  });

  it('tax_rate = 1.01 → RateSetMissing', () => {
    const r = valid_seed();
    r.tax_rate = 1.01;
    expect(() => validate_rate_set(r)).toThrow(/tax_rate/);
  });

  it('tax_rate = -0.01 → RateSetMissing', () => {
    const r = valid_seed();
    r.tax_rate = -0.01;
    expect(() => validate_rate_set(r)).toThrow(/tax_rate/);
  });

  // last_verified_date
  it('last_verified_date = unparseable → RateSetMissing', () => {
    const r = valid_seed();
    r.last_verified_date = 'not-a-date';
    expect(() => validate_rate_set(r)).toThrow(/last_verified_date/);
  });

  it('last_verified_date = number → RateSetMissing (must be string)', () => {
    const r = valid_seed();
    r.last_verified_date = 20260401;
    expect(() => validate_rate_set(r)).toThrow(/last_verified_date/);
  });
});

// ── load_rate_set ─────────────────────────────────────────────

describe('load_rate_set — JSON + object input', () => {
  it('valid JSON string → returns RateSet', () => {
    const json = JSON.stringify(TEST_RATE_SET_FL_2026_Q2_V1);
    const rs = load_rate_set(json);
    expect(rs.version).toBe('FL-TEST-2026-Q2-v1');
  });

  it('valid object input (skip parse) → returns RateSet', () => {
    const rs = load_rate_set(valid_seed());
    expect(rs.version).toBe('FL-TEST-2026-Q2-v1');
  });

  it('malformed JSON → RateSetMissing with parse-error message', () => {
    expect(() => load_rate_set('{ broken json'))
      .toThrow(RateSetMissing);
    try {
      load_rate_set('{ broken json');
    } catch (e) {
      expect((e as Error).message).toContain('parse failed');
    }
  });

  it('valid JSON but invalid structure → RateSetMissing from validator', () => {
    expect(() => load_rate_set('{"version": ""}')).toThrow(RateSetMissing);
  });

  it('empty JSON object → RateSetMissing', () => {
    expect(() => load_rate_set('{}')).toThrow(RateSetMissing);
  });
});

// ── Staleness ─────────────────────────────────────────────────

describe('check_rate_set_staleness', () => {
  it('recent date → null', () => {
    const rs = (valid_seed() as unknown) as RateSet & { last_verified_date: string };
    rs.last_verified_date = '2026-04-01';
    const flag = check_rate_set_staleness(rs, new Date('2026-04-23'));
    expect(flag).toBeNull();
  });

  it('exactly 365 days ago → null (boundary — > not ≥)', () => {
    const rs: RateSet = { ...(valid_seed() as unknown) as RateSet, last_verified_date: '2025-04-23' };
    const flag = check_rate_set_staleness(rs, new Date('2026-04-23'));
    expect(flag).toBeNull();
  });

  it('366 days ago → fires rate_set_stale warning', () => {
    const rs: RateSet = { ...(valid_seed() as unknown) as RateSet, last_verified_date: '2025-04-22' };
    const flag = check_rate_set_staleness(rs, new Date('2026-04-23'));
    expect(flag).not.toBeNull();
    expect(flag?.code).toBe('rate_set_stale');
    expect(flag?.severity).toBe('warning');
    expect(flag?.message).toContain('FL-TEST-2026-Q2-v1');
    expect(flag?.remediation).toBeDefined();
  });

  it('very old date (3 years) → fires flag with large day count', () => {
    const rs: RateSet = { ...(valid_seed() as unknown) as RateSet, last_verified_date: '2023-04-23' };
    const flag = check_rate_set_staleness(rs, new Date('2026-04-23'));
    expect(flag).not.toBeNull();
    // Day count in the message should be large (~1095 days)
    const match = flag?.message.match(/(\d+) days ago/);
    expect(match).toBeTruthy();
    expect(Number(match?.[1])).toBeGreaterThan(1000);
  });

  it('future-dated RateSet → null (weird but not stale)', () => {
    const rs: RateSet = { ...(valid_seed() as unknown) as RateSet, last_verified_date: '2030-01-01' };
    const flag = check_rate_set_staleness(rs, new Date('2026-04-23'));
    expect(flag).toBeNull();
  });

  it('RATE_SET_STALENESS_DAYS is exported and equals 365', () => {
    expect(RATE_SET_STALENESS_DAYS).toBe(365);
  });

  it('reference_date defaults to now (no arg → uses new Date())', () => {
    const rs: RateSet = { ...(valid_seed() as unknown) as RateSet, last_verified_date: '1990-01-01' };
    const flag = check_rate_set_staleness(rs);
    expect(flag).not.toBeNull();
  });
});

// ── Test seed integrity ───────────────────────────────────────

describe('TEST_RATE_SET_FL_2026_Q2_V1 integrity', () => {
  it('passes validate_rate_set (self-check)', () => {
    expect(() => validate_rate_set(TEST_RATE_SET_FL_2026_Q2_V1)).not.toThrow();
  });

  it('version is explicitly TEST-prefixed so it can never be mistaken for production', () => {
    expect(TEST_RATE_SET_FL_2026_Q2_V1.version).toMatch(/TEST/);
  });

  it('source includes the TEST ONLY warning (spec Ground Rule #8)', () => {
    expect(TEST_RATE_SET_FL_2026_Q2_V1.source).toMatch(/TEST ONLY/i);
  });

  it('crew_manhour_rate_usd = 33.85 book historical (§2N)', () => {
    expect(TEST_RATE_SET_FL_2026_Q2_V1.crew_manhour_rate_usd).toBe(33.85);
  });

  it('board_sheathing labor rate = 0.026 mh/sf book (§2N)', () => {
    expect(TEST_RATE_SET_FL_2026_Q2_V1.labor_rates_mh_per_sf.board_sheathing).toBe(0.026);
  });

  it('plywood_sheathing labor rate = 0.013 mh/sf book (§2N)', () => {
    expect(TEST_RATE_SET_FL_2026_Q2_V1.labor_rates_mh_per_sf.plywood_sheathing).toBe(0.013);
  });

  it('material SKUs cover the APA panels the cost engine needs', () => {
    const skus = TEST_RATE_SET_FL_2026_Q2_V1.material_skus_usd_per_sf;
    // At minimum one price per APA row we might select
    expect(skus.plywood_32_16_15_32).toBeGreaterThan(0);
    expect(skus.plywood_48_24_23_32).toBeGreaterThan(0);
    expect(skus.plywood_60_32_7_8).toBeGreaterThan(0);
  });

  it('all material SKU prices are ≥ 0', () => {
    for (const [_sku, price] of Object.entries(
      TEST_RATE_SET_FL_2026_Q2_V1.material_skus_usd_per_sf,
    )) {
      expect(price).toBeGreaterThanOrEqual(0);
    }
  });

  it('tax_rate is in [0, 1]', () => {
    expect(TEST_RATE_SET_FL_2026_Q2_V1.tax_rate).toBeGreaterThanOrEqual(0);
    expect(TEST_RATE_SET_FL_2026_Q2_V1.tax_rate).toBeLessThanOrEqual(1);
  });

  it('last_verified_date is a parseable ISO-8601 date', () => {
    const t = Date.parse(TEST_RATE_SET_FL_2026_Q2_V1.last_verified_date);
    expect(Number.isNaN(t)).toBe(false);
  });

  it('frozen — mutation attempts throw in strict mode', () => {
    expect(Object.isFrozen(TEST_RATE_SET_FL_2026_Q2_V1)).toBe(true);
    expect(Object.isFrozen(TEST_RATE_SET_FL_2026_Q2_V1.labor_rates_mh_per_sf)).toBe(true);
    expect(Object.isFrozen(TEST_RATE_SET_FL_2026_Q2_V1.material_skus_usd_per_sf)).toBe(true);
  });
});
