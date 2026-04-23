/**
 * rotationGizmoMath — Phase 14.F tests.
 *
 * Exercises the pure angle math + drag session in isolation.
 * R3F integration is verified via manual QA per ADR 037.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeDeg,
  xzAngleDeg,
  snapDeg,
  snapStepFor,
  beginDrag,
  dragToRotation,
} from '../rotationGizmoMath';
import type { Vec3 } from '@core/events';

// ── normalizeDeg ──────────────────────────────────────────────

describe('normalizeDeg', () => {
  it('leaves in-range values unchanged', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(90)).toBe(90);
    expect(normalizeDeg(359)).toBe(359);
  });

  it('wraps above 360 and negative values', () => {
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(720)).toBe(0);
    expect(normalizeDeg(-45)).toBe(315);
    expect(normalizeDeg(-360)).toBe(0);
  });
});

// ── xzAngleDeg ────────────────────────────────────────────────

describe('xzAngleDeg', () => {
  const origin: Vec3 = [0, 0, 0];

  it('+X direction → 0°', () => {
    expect(xzAngleDeg(origin, [1, 0, 0])).toBeCloseTo(0, 3);
  });

  it('+Z direction → 90°', () => {
    expect(xzAngleDeg(origin, [0, 0, 1])).toBeCloseTo(90, 3);
  });

  it('-X direction → 180°', () => {
    expect(xzAngleDeg(origin, [-1, 0, 0])).toBeCloseTo(180, 3);
  });

  it('-Z direction → 270°', () => {
    expect(xzAngleDeg(origin, [0, 0, -1])).toBeCloseTo(270, 3);
  });

  it('45° diagonal (+X,+Z) → 45°', () => {
    expect(xzAngleDeg(origin, [1, 0, 1])).toBeCloseTo(45, 3);
  });

  it('ignores Y component', () => {
    const a = xzAngleDeg(origin, [1, 0, 0]);
    const b = xzAngleDeg(origin, [1, 10, 0]);
    const c = xzAngleDeg(origin, [1, -5, 0]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('computes relative to origin, not world zero', () => {
    // Origin at (10, 0, 10), point at (11, 0, 10) → +X from origin → 0°
    expect(xzAngleDeg([10, 0, 10], [11, 0, 10])).toBeCloseTo(0, 3);
    // Origin at (10, 0, 10), point at (10, 0, 11) → +Z from origin → 90°
    expect(xzAngleDeg([10, 0, 10], [10, 0, 11])).toBeCloseTo(90, 3);
  });
});

// ── snapDeg ──────────────────────────────────────────────────

describe('snapDeg', () => {
  it('no-op when step is 0 (still normalizes)', () => {
    expect(snapDeg(123.7, 0)).toBeCloseTo(123.7, 4);
    expect(snapDeg(-45, 0)).toBe(315);
  });

  it('snaps to nearest multiple of step', () => {
    expect(snapDeg(13, 5)).toBe(15);
    expect(snapDeg(12, 5)).toBe(10);
    expect(snapDeg(7.4, 5)).toBe(5);
    expect(snapDeg(7.5, 5)).toBe(10);
  });

  it('cardinal snap to 90°', () => {
    expect(snapDeg(45, 90)).toBe(90); // rounds up at midpoint
    expect(snapDeg(44, 90)).toBe(0);
    expect(snapDeg(135, 90)).toBe(180);
  });

  it('wraps after snap (359 → 360 → 0)', () => {
    expect(snapDeg(359, 5)).toBe(0);
    expect(snapDeg(358, 5)).toBe(0);
  });
});

// ── snapStepFor ──────────────────────────────────────────────

describe('snapStepFor', () => {
  it('fine → 1°', () => { expect(snapStepFor('fine')).toBe(1); });
  it('default → 5°', () => { expect(snapStepFor('default')).toBe(5); });
  it('cardinal → 90°', () => { expect(snapStepFor('cardinal')).toBe(90); });
});

// ── beginDrag + dragToRotation ────────────────────────────────

describe('drag session', () => {
  const origin: Vec3 = [0, 0, 0];

  it('drag starting at +X with fixture at 0° → cursor moves to +Z → fixture rotates to 90°', () => {
    const session = beginDrag(origin, [1, 0, 0], 0);
    expect(session.startFixtureDeg).toBe(0);
    expect(session.startCursorDeg).toBeCloseTo(0, 3);
    // Cursor moves to +Z (90°) → delta is +90° → new rotation = 90°
    const result = dragToRotation(session, origin, [0, 0, 1], 0);
    expect(result).toBeCloseTo(90, 3);
  });

  it('drag from +X to -X → fixture rotates +180° (not 0)', () => {
    const session = beginDrag(origin, [1, 0, 0], 0);
    const result = dragToRotation(session, origin, [-1, 0, 0], 0);
    expect(result).toBeCloseTo(180, 3);
  });

  it('drag starting at angled position — NO jump; only delta counts', () => {
    // Fixture was at 0°. User grabs the ring at 45° (NE). Without
    // delta tracking, naive code would set rotation to 45° instantly.
    // Correct behavior: no change until the cursor actually moves.
    const session = beginDrag(origin, [1, 0, 1], 0); // cursor at 45°
    // Cursor didn't move; fixture stays at 0°.
    const result = dragToRotation(session, origin, [1, 0, 1], 0);
    expect(result).toBeCloseTo(0, 3);
  });

  it('delta accumulates from non-zero start rotation', () => {
    // Fixture was at 90°. User grabs ring at 0° and moves cursor to +Z (90°)
    // Delta = +90°. New rotation = 90° + 90° = 180°.
    const session = beginDrag(origin, [1, 0, 0], 90);
    const result = dragToRotation(session, origin, [0, 0, 1], 0);
    expect(result).toBeCloseTo(180, 3);
  });

  it('snap step applies to the final rotation', () => {
    const session = beginDrag(origin, [1, 0, 0], 0);
    // Move cursor 13° — with step=5, snaps to 15°.
    const cursor13deg: Vec3 = [Math.cos(13 * Math.PI / 180), 0, Math.sin(13 * Math.PI / 180)];
    expect(dragToRotation(session, origin, cursor13deg, 5)).toBeCloseTo(15, 3);
  });

  it('cardinal snap (90°) with a 47° drag → snaps to 90°', () => {
    const session = beginDrag(origin, [1, 0, 0], 0);
    const cursor47deg: Vec3 = [Math.cos(47 * Math.PI / 180), 0, Math.sin(47 * Math.PI / 180)];
    expect(dragToRotation(session, origin, cursor47deg, 90)).toBeCloseTo(90, 3);
  });

  it('fixture origin can be anywhere in world space', () => {
    const offsetOrigin: Vec3 = [100, 3, -50];
    const cursorStart: Vec3 = [101, 3, -50]; // +X from origin → 0°
    const cursorEnd: Vec3 = [100, 3, -49];  // +Z from origin → 90°
    const session = beginDrag(offsetOrigin, cursorStart, 45);
    expect(dragToRotation(session, offsetOrigin, cursorEnd, 0)).toBeCloseTo(135, 3);
  });

  it('drag past 360° wraps cleanly (no jump)', () => {
    // Fixture at 350°, user drags +30° → should end at 20°, not 380°.
    const session = beginDrag(origin, [1, 0, 0], 350);
    const cursor30: Vec3 = [Math.cos(30 * Math.PI / 180), 0, Math.sin(30 * Math.PI / 180)];
    expect(dragToRotation(session, origin, cursor30, 0)).toBeCloseTo(20, 3);
  });
});
