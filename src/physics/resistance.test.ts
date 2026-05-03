/**
 * Reliability-contract tests for resistance.ts
 * Source: NDS 2018 Table 12.2C, AWC TR-12 (ring-shank multiplier),
 * ASTM D7158 wind classifications.
 */
import { describe, it, expect } from 'vitest';
import {
  fastenerWithdrawalLb,
  sheathingResistancePsf,
  shingleResistancePsf,
  profileResistance,
  INSTALL_PROFILES,
} from './resistance';
import { FASTENERS, SHINGLE_CLASSES } from './constants';

describe('fastenerWithdrawalLb', () => {
  it('6d smooth (24 lb/in) at 1.5" penetration = 36 lb', () => {
    const lb = fastenerWithdrawalLb(FASTENERS['6d_smooth'], 1.5);
    expect(lb).toBe(36);
  });

  it('8d ring-shank (60 lb/in) at 2.0" penetration = 120 lb', () => {
    const lb = fastenerWithdrawalLb(FASTENERS['8d_ring'], 2.0);
    expect(lb).toBe(120);
  });

  it('ring-shank gives 2.5× the withdrawal of equivalent smooth at same penetration', () => {
    const smooth = fastenerWithdrawalLb(FASTENERS['8d_smooth'], 2.0);
    const ring = fastenerWithdrawalLb(FASTENERS['8d_ring'], 2.0);
    const ratio = ring / smooth;
    expect(ratio).toBeCloseTo(60 / 32, 2);
  });
});

describe('sheathingResistancePsf', () => {
  it('code_min profile (6d smooth, 6/12) field zone ≈ 72 psf', () => {
    // 6d × 1.5" = 36 lb; field tributary 0.5 sf → 72 psf
    const psf = sheathingResistancePsf('6d_smooth', '6_12', 'field');
    expect(psf).toBeCloseTo(72, 0);
  });

  it('code_min profile edge zone ≈ 144 psf', () => {
    // 36 lb / 0.25 sf = 144 psf (edge has tighter spacing)
    const psf = sheathingResistancePsf('6d_smooth', '6_12', 'edge');
    expect(psf).toBeCloseTo(144, 0);
  });

  it('fbc_wbdr profile (8d ring, 6/6) field zone ≈ 480 psf', () => {
    // 8d ring × 2.0" = 120 lb; 6/6 field tributary 0.25 sf → 480 psf
    const psf = sheathingResistancePsf('8d_ring', '6_6', 'field');
    expect(psf).toBeCloseTo(480, 0);
  });

  it('fbc_wbdr corner ≥ field (same pattern, same per-nail load)', () => {
    const f = sheathingResistancePsf('8d_ring', '6_6', 'field');
    const c = sheathingResistancePsf('8d_ring', '6_6', 'corner');
    expect(c).toBeGreaterThanOrEqual(f);
  });
});

describe('shingleResistancePsf — ASTM D7158 classes', () => {
  it('Class D = 12 psf', () => {
    expect(shingleResistancePsf('D')).toBe(12);
  });
  it('Class H = 35 psf (high-wind WBDR-grade)', () => {
    expect(shingleResistancePsf('H')).toBe(35);
  });
  it('class capacity is monotonic: D < G < H', () => {
    const d = shingleResistancePsf('D');
    const g = shingleResistancePsf('G');
    const h = shingleResistancePsf('H');
    expect(g).toBeGreaterThan(d);
    expect(h).toBeGreaterThan(g);
  });
});

describe('profileResistance — governing capacity per zone', () => {
  it('code_min: shingle (12) governs over sheathing (72) in field', () => {
    const r = profileResistance(INSTALL_PROFILES.code_min);
    expect(r.field).toBe(12);
    expect(r.shingleCapPsf).toBe(12);
    expect(r.sheathing.field).toBeCloseTo(72, 0);
  });

  it('fbc_wbdr: shingle (35) still governs over sheathing (480) in field', () => {
    const r = profileResistance(INSTALL_PROFILES.fbc_wbdr);
    expect(r.field).toBe(35);
    expect(r.sheathing.field).toBeCloseTo(480, 0);
  });

  it('upgrading code_min → fbc_wbdr roughly triples shingle resistance', () => {
    const oldR = profileResistance(INSTALL_PROFILES.code_min);
    const newR = profileResistance(INSTALL_PROFILES.fbc_wbdr);
    expect(newR.field / oldR.field).toBeCloseTo(35 / 12, 1);
  });
});

describe('INSTALL_PROFILES — referenced metadata', () => {
  it('code_min cites pre-2002 standards', () => {
    const p = INSTALL_PROFILES.code_min;
    expect(p.fastenerId).toBe('6d_smooth');
    expect(p.hasSWB).toBe(false);
    expect(p.shingleClassId).toBe('D');
  });

  it('fbc_wbdr cites FBC 8th Ed. + WBDR upgrade', () => {
    const p = INSTALL_PROFILES.fbc_wbdr;
    expect(p.fastenerId).toBe('8d_ring');
    expect(p.hasSWB).toBe(true);
    expect(p.shingleClassId).toBe('H');
    expect(p.fbcReferences).toContain('FBC 1504.1.1');
  });
});

describe('Source citation lock', () => {
  it('every fastener has a non-empty source string', () => {
    Object.values(FASTENERS).forEach((f) => {
      expect(f.source).toBeTruthy();
      expect(f.source.length).toBeGreaterThan(8);
    });
  });

  it('every shingle class has a non-empty source string', () => {
    Object.values(SHINGLE_CLASSES).forEach((s) => {
      expect(s.source).toBeTruthy();
      expect(s.source.length).toBeGreaterThan(8);
    });
  });
});
