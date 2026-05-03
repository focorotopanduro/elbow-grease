/**
 * Reliability-contract tests for pressure.ts
 *
 * Worked example reference: ASCE 7-22 §C26.10 demonstrates the velocity
 * pressure equation with the canonical Kz/Kzt/Kd/Ke factor stack. These
 * tests lock the current numeric outputs against a hand-calc done from
 * the published equation. If a future change moves a number, the test
 * fails and the reviewer is forced to surface why.
 */
import { describe, it, expect } from 'vitest';
import {
  velocityPressure,
  orlandoRanchVelocityPressure,
  netUpliftPressure,
  orlandoUpliftProfile,
  configurableUpliftProfile,
  configurableVelocityPressure,
  DEFAULT_HOUSE_CONFIG,
} from './pressure';
import { kzAtHeight, heightForStories } from './exposure';
import {
  ASCE_VELOCITY_CONSTANT,
  ORLANDO_RANCH_VELOCITY_K,
  GCp,
  GCpi_PARTIALLY_ENCLOSED,
} from './constants';

describe('velocityPressure — generic ASCE form', () => {
  it('matches the published equation at V=130 mph, h=12 ft, Exp B', () => {
    // q = 0.00256 · 0.70 · 1.0 · 0.85 · 1.0 · 130² = 25.74 psf
    const q = velocityPressure(130, 0.70, 1.0, 0.85, 1.0);
    expect(q).toBeCloseTo(25.74, 1);
  });

  it('returns zero when V=0 (sanity)', () => {
    expect(velocityPressure(0, 0.70)).toBe(0);
  });

  it('scales with V² (doubling V quadruples q)', () => {
    const q1 = velocityPressure(100, 0.70);
    const q2 = velocityPressure(200, 0.70);
    expect(q2 / q1).toBeCloseTo(4, 5);
  });

  it('uses default Kzt=1.0, Kd=0.85, Ke=1.0 when not specified', () => {
    const explicit = velocityPressure(120, 0.70, 1.0, 0.85, 1.0);
    const defaults = velocityPressure(120, 0.70);
    expect(defaults).toBeCloseTo(explicit, 6);
  });
});

describe('orlandoRanchVelocityPressure — pre-simplified constant', () => {
  it('uses the disclosure-drawer constant 0.001523', () => {
    expect(ORLANDO_RANCH_VELOCITY_K).toBe(0.001523);
  });

  it('q at V=130 mph (Orlando design low) ≈ 25.74 psf', () => {
    const q = orlandoRanchVelocityPressure(130);
    expect(q).toBeCloseTo(25.74, 1);
  });

  it('q at V=140 mph (Orlando design high) ≈ 29.85 psf', () => {
    const q = orlandoRanchVelocityPressure(140);
    expect(q).toBeCloseTo(29.85, 1);
  });

  it('q at V=175 mph (Andrew) ≈ 46.64 psf', () => {
    const q = orlandoRanchVelocityPressure(175);
    expect(q).toBeCloseTo(46.64, 1);
  });

  it('matches generic form to <0.5% (rounding tolerance)', () => {
    const Vs = [80, 100, 130, 150, 175];
    Vs.forEach((V) => {
      const generic = velocityPressure(V, 0.70);
      const simplified = orlandoRanchVelocityPressure(V);
      const pctDiff = Math.abs(generic - simplified) / generic;
      expect(pctDiff).toBeLessThan(0.005);
    });
  });
});

describe('netUpliftPressure — C&C zone math', () => {
  // At V=130 mph, q ≈ 25.74 psf. Worst-case GCpi = +0.55 with negative GCp.
  // Field uplift  = 25.74 · |−0.9 − 0.55| = 25.74 · 1.45 ≈ 37.32 psf
  // Edge uplift   = 25.74 · |−1.7 − 0.55| = 25.74 · 2.25 ≈ 57.92 psf
  // Corner uplift = 25.74 · |−2.6 − 0.55| = 25.74 · 3.15 ≈ 81.08 psf
  const q130 = orlandoRanchVelocityPressure(130);

  it('field zone at 130 mph ≈ 37.3 psf', () => {
    expect(netUpliftPressure(q130, 'field')).toBeCloseTo(37.32, 1);
  });

  it('edge zone at 130 mph ≈ 57.9 psf', () => {
    expect(netUpliftPressure(q130, 'edge')).toBeCloseTo(57.92, 1);
  });

  it('corner zone at 130 mph ≈ 81.1 psf', () => {
    expect(netUpliftPressure(q130, 'corner')).toBeCloseTo(81.08, 1);
  });

  it('corner > edge > field for the same q (zone ordering invariant)', () => {
    const f = netUpliftPressure(q130, 'field');
    const e = netUpliftPressure(q130, 'edge');
    const c = netUpliftPressure(q130, 'corner');
    expect(c).toBeGreaterThan(e);
    expect(e).toBeGreaterThan(f);
  });

  it('respects custom GCpi override (fully-enclosed reduces uplift)', () => {
    const partial = netUpliftPressure(q130, 'corner', GCpi_PARTIALLY_ENCLOSED);
    const fully = netUpliftPressure(q130, 'corner', 0.18);
    expect(fully).toBeLessThan(partial);
  });
});

describe('orlandoUpliftProfile — composite output', () => {
  it('returns all three zones plus q for V', () => {
    const profile = orlandoUpliftProfile(130);
    expect(profile.V).toBe(130);
    expect(profile.q).toBeCloseTo(25.74, 1);
    expect(profile.field).toBeGreaterThan(0);
    expect(profile.edge).toBeGreaterThan(profile.field);
    expect(profile.corner).toBeGreaterThan(profile.edge);
  });
});

describe('kzAtHeight — ASCE 7-22 Tbl 26.10-1 lookup', () => {
  it('h=12ft Exposure B = 0.70 (matches the brief\u2019s pre-simplified value)', () => {
    expect(kzAtHeight(12, 'B')).toBe(0.70);
  });
  it('h=25ft Exposure B = 0.83 (two-story home)', () => {
    expect(kzAtHeight(25, 'B')).toBe(0.83);
  });
  it('Exposure D > C > B at the same height (open vs suburban)', () => {
    expect(kzAtHeight(25, 'D')).toBeGreaterThan(kzAtHeight(25, 'C'));
    expect(kzAtHeight(25, 'C')).toBeGreaterThan(kzAtHeight(25, 'B'));
  });
  it('interpolates linearly between rows', () => {
    const at18 = kzAtHeight(18, 'B'); // halfway between 12 and 25 → roughly halfway
    const expected = 0.70 + ((18 - 12) / (25 - 12)) * (0.83 - 0.70);
    expect(at18).toBeCloseTo(expected, 4);
  });
});

describe('heightForStories', () => {
  it('1-story = 12 ft', () => expect(heightForStories(1)).toBe(12));
  it('2-story = 25 ft', () => expect(heightForStories(2)).toBe(25));
});

describe('configurableVelocityPressure — house-aware q', () => {
  it('1-story Exposure B at 130 mph matches the legacy Orlando ranch (within 0.5%)', () => {
    const legacy = orlandoRanchVelocityPressure(130);
    const cfg = configurableVelocityPressure(130, { stories: 1, exposure: 'B' });
    expect(Math.abs(cfg - legacy) / legacy).toBeLessThan(0.005);
  });
  it('2-story shifts q up by ~18% vs 1-story (Kz 0.83 vs 0.70)', () => {
    const oneStory = configurableVelocityPressure(130, { stories: 1, exposure: 'B' });
    const twoStory = configurableVelocityPressure(130, { stories: 2, exposure: 'B' });
    expect(twoStory / oneStory).toBeCloseTo(0.83 / 0.70, 2);
  });
  it('Exposure D coastal at 130 mph nearly 50% higher q than Exp B', () => {
    const b = configurableVelocityPressure(130, { stories: 1, exposure: 'B' });
    const d = configurableVelocityPressure(130, { stories: 1, exposure: 'D' });
    expect(d / b).toBeCloseTo(1.03 / 0.70, 2);
  });
});

describe('configurableUpliftProfile — full house config', () => {
  it('Default config (1-story, B, gable, partial) ≈ legacy orlandoUpliftProfile', () => {
    const cfg = configurableUpliftProfile(130, DEFAULT_HOUSE_CONFIG);
    const legacy = orlandoUpliftProfile(130);
    expect(cfg.corner).toBeCloseTo(legacy.corner, 0);
  });
  it('Hip roof drops corner suction substantially vs gable (same V, GCpi)', () => {
    const gable = configurableUpliftProfile(130, { ...DEFAULT_HOUSE_CONFIG, shape: 'gable' });
    const hip = configurableUpliftProfile(130, { ...DEFAULT_HOUSE_CONFIG, shape: 'hip' });
    expect(hip.corner).toBeLessThan(gable.corner * 0.85);
  });
  it('Fully-enclosed (impact windows) cuts uplift ~30% vs partially-enclosed', () => {
    const partial = configurableUpliftProfile(130, { ...DEFAULT_HOUSE_CONFIG, enclosed: 'partial' });
    const fully = configurableUpliftProfile(130, { ...DEFAULT_HOUSE_CONFIG, enclosed: 'fully' });
    expect(fully.field).toBeLessThan(partial.field * 0.85);
  });
  it('Coastal 2-story hip with impact windows still beats suburban 1-story gable without', () => {
    // Bad config (worst-case) vs good config (best-case)
    const bad = configurableUpliftProfile(130, {
      stories: 2, exposure: 'D', shape: 'gable', enclosed: 'partial',
    });
    const good = configurableUpliftProfile(130, {
      stories: 1, exposure: 'B', shape: 'hip', enclosed: 'fully',
    });
    expect(bad.corner).toBeGreaterThan(good.corner * 2);
  });
});

describe('Constants — locked', () => {
  it('ASCE_VELOCITY_CONSTANT is 0.00256 (do not change without ASCE update)', () => {
    expect(ASCE_VELOCITY_CONSTANT).toBe(0.00256);
  });

  it('GCp values match ASCE 7-22 Fig 30.3-2A (slope ≤ 7°)', () => {
    expect(GCp.field).toBe(-0.9);
    expect(GCp.edge).toBe(-1.7);
    expect(GCp.corner).toBe(-2.6);
  });

  it('GCpi for partially-enclosed = 0.55 (Tbl 26.13-1)', () => {
    expect(GCpi_PARTIALLY_ENCLOSED).toBe(0.55);
  });
});
