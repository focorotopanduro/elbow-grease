/**
 * Tests for the damped-harmonic sway calculator.
 */
import { describe, it, expect } from 'vitest';
import { computeSway } from './sway';

describe('computeSway — damped harmonic biomechanics', () => {
  it('returns 0 amplitude when baseline=0 and gust=0 and noise=0', () => {
    // sin(0) = 0, so phase=0 → 0
    expect(computeSway(0, 0, 0, 0, 0)).toBe(0);
  });

  it('amplitude scales monotonically with baseline wind', () => {
    // Pick a t where sin(idleFreq * t) is near 1
    const t = Math.PI / (2 * 0.6); // peak of slow harmonic at baseline=0
    const lo = computeSway(t, 0.1, 0, 0, 0);
    const hi = computeSway(t, 0.9, 0, 0, 0);
    expect(Math.abs(hi)).toBeGreaterThan(Math.abs(lo));
  });

  it('gust adds 12° per unit gust', () => {
    const baseline = 0.5;
    const noise = 0;
    const phase = 0;
    const t = 0;
    const noGust = computeSway(t, baseline, 0, noise, phase);
    const withGust = computeSway(t, baseline, 1, noise, phase);
    expect(withGust - noGust).toBeCloseTo(12, 5);
  });

  it('phase offset shifts the trace (no two trees move identically)', () => {
    const a = computeSway(1, 0.5, 0, 0, 0);
    const b = computeSway(1, 0.5, 0, 0, 1.4);
    expect(a).not.toBeCloseTo(b, 4);
  });
});
