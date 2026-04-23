/**
 * SectorPredictor — Phase 5 acceptance tests.
 *
 * Each test feeds a synthetic sample stream and asserts the predicted
 * sector id matches the expected landing zone.
 *
 * Geometry fixture: an 8-sector wheel, 22.5° half-width each, inner
 * radius 60 px, outer radius 180 px. Sector 0 is centered at 0 rad
 * (east); sectors march counter-clockwise every 45°.
 */

import { describe, it, expect } from 'vitest';
import { SectorPredictor, findSectorAtAngle, type BaseSector } from '../SectorPredictor';

// ── Fixture: 8-sector wheel ────────────────────────────────────

const SECTORS: BaseSector[] = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  centerAngleRad: (i * Math.PI) / 4,      // 0, 45°, 90°, …
  halfWidthRad: Math.PI / 8,              // 22.5°
}));

const INNER = 60;
const OUTER = 180;

// ── findSectorAtAngle ────────────────────────────────────────

describe('findSectorAtAngle', () => {
  it('maps exact centers to the corresponding sector', () => {
    for (const s of SECTORS) {
      expect(findSectorAtAngle(s.centerAngleRad, SECTORS)).toBe(s.id);
    }
  });

  it('returns null for gaps between sectors (our wheel has none)', () => {
    // All our sectors tile exactly — at a boundary we'll match one of them.
    // Test: a wheel with narrower sectors so gaps exist.
    const sparse: BaseSector[] = [
      { id: 'a', centerAngleRad: 0, halfWidthRad: 0.1 },
    ];
    expect(findSectorAtAngle(Math.PI / 2, sparse)).toBe(null);
    expect(findSectorAtAngle(0, sparse)).toBe('a');
  });

  it('handles wrap-around at 2π', () => {
    // Angle slightly less than 2π should match sector 0 (center 0).
    expect(findSectorAtAngle(Math.PI * 2 - 0.01, SECTORS)).toBe('s0');
  });
});

// ── SectorPredictor: speed gating ─────────────────────────────

describe('SectorPredictor — speed gating', () => {
  it('stationary cursor → null (no prediction on zero velocity)', () => {
    const p = new SectorPredictor();
    for (let t = 0; t < 100; t += 10) {
      p.addSample(100, 0, t); // planted on sector 0's eastern axis
    }
    expect(p.predict({ baseSectors: SECTORS, innerRadius: INNER, outerRadius: OUTER })).toBe(null);
  });

  it('slow drift below minSpeed → null', () => {
    const p = new SectorPredictor();
    // 0.05 px/ms = 50 px/s — well below default 0.15 threshold
    for (let t = 0; t <= 60; t += 10) {
      p.addSample(100 + t * 0.05, 0, t);
    }
    expect(p.predict({ baseSectors: SECTORS, innerRadius: INNER, outerRadius: OUTER })).toBe(null);
  });

  it('single sample → null (need ≥2 for velocity)', () => {
    const p = new SectorPredictor();
    p.addSample(100, 100, 0);
    expect(p.predict({ baseSectors: SECTORS, innerRadius: INNER, outerRadius: OUTER })).toBe(null);
  });
});

// ── Flick predictions ─────────────────────────────────────────

describe('SectorPredictor — flick toward a sector', () => {
  it('flick toward sector 2 (north, 90°) predicts s2 before arrival', () => {
    const p = new SectorPredictor();
    // Start near center, flick straight up at ~1 px/ms (≈ 1000 px/s).
    //   t=0   cursor at (0, 10)  — just above dead zone
    //   t=20  cursor at (0, 30)
    //   t=40  cursor at (0, 50)  — still INSIDE inner radius (60)
    //   t=60  cursor at (0, 70)  — just crossed into the annulus
    //
    // At t=60, the actual hit-test WOULD succeed for sector 2 (90°)
    // but the predictor fed from t=0 samples should already have
    // projected forward to y=160 and returned "s2".
    const samples = [
      [0, 10, 0],
      [0, 30, 20],
      [0, 50, 40],
    ] as const;
    for (const [x, y, t] of samples) p.addSample(x, y, t);
    const predicted = p.predict({
      baseSectors: SECTORS,
      innerRadius: INNER,
      outerRadius: OUTER,
      lookaheadMs: 90,
    });
    // Velocity vector is (0, 1) px/ms. After 90ms lookahead from newest
    // sample (0, 50), projected = (0, 140). That's inside annulus at
    // 90°, i.e. sector 2.
    expect(predicted).toBe('s2');
  });

  it('flick toward sector 0 (east) predicts s0', () => {
    const p = new SectorPredictor();
    for (let t = 0; t <= 40; t += 10) {
      p.addSample(10 + t, 0, t); // 1 px/ms eastward
    }
    const predicted = p.predict({
      baseSectors: SECTORS,
      innerRadius: INNER,
      outerRadius: OUTER,
      lookaheadMs: 90,
    });
    expect(predicted).toBe('s0');
  });

  it('diagonal flick (NE) predicts sector 1 (45°)', () => {
    const p = new SectorPredictor();
    for (let t = 0; t <= 40; t += 10) {
      const k = 0.7 + t * 0.7; // 0.7 px/ms in each axis
      p.addSample(k, k, t);
    }
    const predicted = p.predict({
      baseSectors: SECTORS,
      innerRadius: INNER,
      outerRadius: OUTER,
      lookaheadMs: 90,
    });
    expect(predicted).toBe('s1');
  });
});

// ── Predictor stays inert when target is out of range ─────────

describe('SectorPredictor — out-of-annulus', () => {
  it('fast motion away from center past outer radius → null', () => {
    const p = new SectorPredictor();
    // Already outside outerRadius, moving further out.
    p.addSample(200, 0, 0);
    p.addSample(210, 0, 10);
    p.addSample(220, 0, 20);
    p.addSample(230, 0, 30);
    const predicted = p.predict({
      baseSectors: SECTORS,
      innerRadius: INNER,
      outerRadius: OUTER,
      lookaheadMs: 90,
    });
    expect(predicted).toBe(null);
  });

  it('motion that would land inside the dead zone → null', () => {
    const p = new SectorPredictor();
    // Starts inside annulus but decelerating toward center — projection
    // lands inside inner radius.
    p.addSample(100, 0, 0);
    p.addSample(90, 0, 10);
    p.addSample(80, 0, 20);
    p.addSample(70, 0, 30);
    const predicted = p.predict({
      baseSectors: SECTORS,
      innerRadius: INNER,
      outerRadius: OUTER,
      lookaheadMs: 90,
    });
    // Velocity (-1, 0), projected from (70, 0) at lookahead 90ms →
    // (70 - 90, 0) = (-20, 0). |pr| = 20, below INNER=60 → null.
    expect(predicted).toBe(null);
  });
});

// ── Mid-flight correction ────────────────────────────────────

describe('SectorPredictor — mid-flight correction', () => {
  it('cursor pivots east then north: recent samples win', () => {
    const p = new SectorPredictor();
    // Four samples: two heading east, two heading north.
    // With a 4-sample buffer, the average velocity over the window is
    // (+2, +2) — a 45° diagonal — so prediction should be sector 1.
    //
    // This test pins the "average over the full window" behavior.
    // If we switched to "last pair" velocity the expected id would
    // change; that's a deliberate design decision documented in the
    // implementation header.
    p.addSample(10, 0, 0);
    p.addSample(20, 0, 10);
    p.addSample(20, 10, 20);
    p.addSample(20, 20, 30);
    const predicted = p.predict({
      baseSectors: SECTORS,
      innerRadius: INNER,
      outerRadius: OUTER,
      lookaheadMs: 90,
    });
    // Velocity (10/30, 20/30) ≈ (0.33, 0.67). Projected from (20, 20):
    // (20 + 30, 20 + 60) = (50, 80). Radius ≈ 94 (inside annulus),
    // angle atan2(80, 50) ≈ 58° → sector 1 (center 45°, half 22.5°,
    // range [22.5°, 67.5°]). 58° is inside.
    expect(predicted).toBe('s1');
  });
});

// ── Ring buffer capacity ─────────────────────────────────────

describe('SectorPredictor — ring buffer capacity', () => {
  it('only keeps the most recent N samples', () => {
    const p = new SectorPredictor(3);
    for (let i = 0; i < 10; i++) {
      p.addSample(i, 0, i * 10);
    }
    expect(p.sampleCount).toBe(3);
  });

  it('clear() empties the buffer', () => {
    const p = new SectorPredictor();
    p.addSample(0, 0, 0);
    p.addSample(10, 0, 10);
    expect(p.sampleCount).toBe(2);
    p.clear();
    expect(p.sampleCount).toBe(0);
  });

  it('rejects out-of-order timestamps silently', () => {
    const p = new SectorPredictor();
    p.addSample(0, 0, 100);
    p.addSample(10, 0, 50); // older — should be dropped
    expect(p.sampleCount).toBe(1);
  });
});
