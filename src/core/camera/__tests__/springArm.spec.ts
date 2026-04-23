/**
 * springArm — Phase 12.E tests.
 *
 * Pure function, so we can drive it with a fake `raycast` callback
 * and assert every branch deterministically.
 *
 * Covers:
 *   • no collision → returns desired unchanged
 *   • center ray hits → clamp with padding
 *   • only a corner ray hits → still clamps (thin-obstruction case)
 *   • minDistance floor respected even when hit is very close
 *   • collision at target position itself → clamps to minDistance
 *   • padding scales with desired distance
 *   • rayIndex reports which ray hit
 *   • lerpDistance + easeAlpha helpers
 */

import { describe, it, expect } from 'vitest';
import {
  computeSpringArm,
  lerpDistance,
  easeAlpha,
  type Vec3,
  type RaycastFn,
  type SpringArmInput,
} from '../springArm';

// ── Helpers ───────────────────────────────────────────────────

function noHit(): RaycastFn {
  return () => null;
}

/** Always-hit raycaster returning the same distance for every ray. */
function hitAt(distance: number): RaycastFn {
  return () => distance;
}

/**
 * Raycaster that hits only specific ray indices (by invocation order).
 * `hitMap[i]` is the returned distance for the i-th ray; null = miss.
 */
function hitByIndex(hitMap: (number | null)[]): RaycastFn {
  let i = 0;
  return () => {
    const d = hitMap[i] ?? null;
    i++;
    return d;
  };
}

const BASE_INPUT: SpringArmInput = {
  target: [0, 0, 0],
  cameraPosition: [10, 0, 0], // 10 units along +X
  minDistance: 0.5,
  padding: 0.05,
  perpOffset: 0.1,
};

// ── No-collision path ────────────────────────────────────────

describe('no collision', () => {
  it('returns desired distance unchanged', () => {
    const r = computeSpringArm(BASE_INPUT, noHit());
    expect(r.hit).toBe(false);
    expect(r.clampedDistance).toBeCloseTo(10, 5);
    expect(r.desiredDistance).toBeCloseTo(10, 5);
    expect(r.rayIndex).toBe(-1);
  });

  it('still respects minDistance when desired is extremely small', () => {
    const r = computeSpringArm(
      { ...BASE_INPUT, cameraPosition: [0.2, 0, 0] }, // desired 0.2
      noHit(),
    );
    // min is 0.5, desired is 0.2, result should be 0.5.
    expect(r.clampedDistance).toBeCloseTo(0.5, 5);
  });
});

// ── Collision path ────────────────────────────────────────────

describe('center-ray collision', () => {
  it('clamps to hitDistance - (padding * desiredDistance)', () => {
    const r = computeSpringArm(BASE_INPUT, hitAt(6));
    expect(r.hit).toBe(true);
    // padding = 0.05, desired = 10, pullback = 0.5.
    // clamp = 6 - 0.5 = 5.5.
    expect(r.clampedDistance).toBeCloseTo(5.5, 5);
    // rayIndex 0 = center ray fires first and wins all 5.
    expect(r.rayIndex).toBe(0);
  });

  it('rayIndex reports the correct ray when only a corner hits', () => {
    // Rays order: [center, +a+b, +a-b, -a+b, -a-b].
    // Make only the third (index 2) hit.
    const r = computeSpringArm(BASE_INPUT, hitByIndex([null, null, 5, null, null]));
    expect(r.hit).toBe(true);
    expect(r.rayIndex).toBe(2);
    // padding pullback from desired 10 = 0.5; clamp = 5 - 0.5 = 4.5.
    expect(r.clampedDistance).toBeCloseTo(4.5, 5);
  });

  it('picks the closest hit across multiple rays', () => {
    const r = computeSpringArm(BASE_INPUT, hitByIndex([8, 6, 4, 7, 9]));
    expect(r.hit).toBe(true);
    expect(r.rayIndex).toBe(2);
    // closest hit 4, pullback 0.5 → 3.5
    expect(r.clampedDistance).toBeCloseTo(3.5, 5);
  });
});

// ── minDistance floor ─────────────────────────────────────────

describe('minDistance floor', () => {
  it('collision very close → clamp to minDistance (not below)', () => {
    // Hit at 0.1, padding pullback 0.5 → would give -0.4; clamp to min 0.5.
    const r = computeSpringArm(BASE_INPUT, hitAt(0.1));
    expect(r.hit).toBe(true);
    expect(r.clampedDistance).toBe(0.5);
  });

  it('collision AT minDistance → clamp stays at minDistance', () => {
    const r = computeSpringArm(
      { ...BASE_INPUT, minDistance: 1, padding: 0 },
      hitAt(1),
    );
    expect(r.clampedDistance).toBe(1);
  });
});

// ── Padding ──────────────────────────────────────────────────

describe('padding scaling', () => {
  it('padding=0 → clamp to exact hit distance', () => {
    const r = computeSpringArm(
      { ...BASE_INPUT, padding: 0 },
      hitAt(7),
    );
    expect(r.clampedDistance).toBeCloseTo(7, 5);
  });

  it('padding=0.1 on desired=20 → 2-unit pullback', () => {
    const r = computeSpringArm(
      { ...BASE_INPUT, cameraPosition: [20, 0, 0], padding: 0.1 },
      hitAt(10),
    );
    // desired=20, padding=0.1 → pullback=2. clamp = 10 - 2 = 8.
    expect(r.clampedDistance).toBeCloseTo(8, 5);
  });
});

// ── Degenerate camera-on-target ──────────────────────────────

describe('camera on top of target', () => {
  it('returns at least minDistance, no hit', () => {
    const input: SpringArmInput = {
      ...BASE_INPUT,
      cameraPosition: [0, 0, 0],
    };
    const r = computeSpringArm(input, hitAt(5));
    expect(r.clampedDistance).toBe(input.minDistance);
    expect(r.hit).toBe(false); // degenerate path skips raycast
  });
});

// ── Direction-basis sanity ───────────────────────────────────

describe('basis-vector construction', () => {
  // Two inputs with different orientations — confirm raycast is called
  // exactly 5 times each. (We probe via hitByIndex's internal counter.)
  it('fires exactly 5 rays per call', () => {
    let calls = 0;
    const counting: RaycastFn = () => { calls++; return null; };
    computeSpringArm(BASE_INPUT, counting);
    expect(calls).toBe(5);
  });

  it('works for a camera above target (vertical direction)', () => {
    const input: SpringArmInput = {
      ...BASE_INPUT,
      cameraPosition: [0, 10, 0], // straight up
    };
    // No hit → unchanged.
    const r = computeSpringArm(input, noHit());
    expect(r.clampedDistance).toBeCloseTo(10, 5);
  });

  it('ray directions reach the camera — center-ray endpoint equals cameraPosition', () => {
    // Recover the center-ray direction by stubbing raycast to record args.
    let origin: Vec3 | null = null;
    let direction: Vec3 | null = null;
    const recording: RaycastFn = (o, d) => {
      if (!origin) { origin = o; direction = d; }
      return null;
    };
    const input: SpringArmInput = {
      target: [1, 2, 3],
      cameraPosition: [4, 2, 3], // 3 units +X from target
      minDistance: 0.5,
      padding: 0.05,
    };
    computeSpringArm(input, recording);
    expect(origin).toEqual([1, 2, 3]);       // first ray origin = target
    // direction should be normalized (+X, 0, 0)
    expect(direction!).not.toBeNull();
    expect(direction![0]).toBeCloseTo(1, 5);
    expect(direction![1]).toBeCloseTo(0, 5);
    expect(direction![2]).toBeCloseTo(0, 5);
  });
});

// ── Helpers ──────────────────────────────────────────────────

describe('lerpDistance', () => {
  it('alpha=0 → stays at current', () => {
    expect(lerpDistance(3, 10, 0)).toBe(3);
  });

  it('alpha=1 → jumps to target', () => {
    expect(lerpDistance(3, 10, 1)).toBe(10);
  });

  it('alpha=0.5 → halfway', () => {
    expect(lerpDistance(3, 10, 0.5)).toBeCloseTo(6.5, 5);
  });
});

describe('easeAlpha', () => {
  it('dt=0 → 0 (no move)', () => {
    expect(easeAlpha(0, 0.15)).toBeCloseTo(0, 5);
  });

  it('dt=timeConstant → ~63% (1 - 1/e)', () => {
    expect(easeAlpha(0.15, 0.15)).toBeCloseTo(1 - Math.exp(-1), 4);
  });

  it('zero timeConstant → instantaneous (alpha=1)', () => {
    expect(easeAlpha(0.016, 0)).toBe(1);
  });

  it('large dt → approaches 1 asymptotically', () => {
    expect(easeAlpha(1, 0.15)).toBeGreaterThan(0.99);
  });
});
