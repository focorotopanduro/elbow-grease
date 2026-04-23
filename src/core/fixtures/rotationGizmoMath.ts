/**
 * rotationGizmoMath — Phase 14.F
 *
 * Pure math for the in-scene rotation gizmo. Given a pointer-hit
 * world point + the fixture's world position, computes the angle
 * around the Y axis. Also handles delta-tracking (so drag doesn't
 * jump when the user's cursor enters the ring far from 0°) and
 * snap modes.
 *
 * No React, no Three.js — just Vec3 tuples and numbers. This keeps
 * the tricky angle math unit-testable without spinning up R3F.
 */

import type { Vec3 } from '@core/events';

/** Normalize to [0, 360) — `((x % 360) + 360) % 360` avoids `-0`. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Angle (in degrees, [0, 360)) from `origin` to `point`, measured in
 * the XZ plane (ignoring Y). 0° points down +X, rotates CCW when
 * viewed from +Y looking down (standard mathematical convention).
 *
 * This matches the R3F default camera setup: Y is up, so top-down
 * rotation is a natural frame of reference.
 */
export function xzAngleDeg(origin: Vec3, point: Vec3): number {
  const dx = point[0] - origin[0];
  const dz = point[2] - origin[2];
  // atan2(z, x) gives the standard mathematical angle in the XZ plane.
  // Note: in a left-handed screen frame some teams flip the sign of z;
  // we use a right-handed world (three.js default) where this is the
  // correct direction.
  const rad = Math.atan2(dz, dx);
  return normalizeDeg((rad * 180) / Math.PI);
}

/**
 * Snap a raw rotation to a step size, avoiding the bias of always
 * rounding down near 0. `step = 0` means no snap.
 */
export function snapDeg(deg: number, step: number): number {
  if (step <= 0) return normalizeDeg(deg);
  return normalizeDeg(Math.round(deg / step) * step);
}

export type RotationSnapMode =
  | 'fine'        // 1° (Shift held)
  | 'default'     // 5°
  | 'cardinal';   // 90° (Ctrl held)

export function snapStepFor(mode: RotationSnapMode): number {
  switch (mode) {
    case 'fine': return 1;
    case 'default': return 5;
    case 'cardinal': return 90;
  }
}

/**
 * Drag-session state. Captured on pointerDown, consulted on
 * pointerMove to produce a deterministic new rotation.
 */
export interface GizmoDragSession {
  /** Fixture rotationDeg at the moment the drag started. */
  startFixtureDeg: number;
  /** Cursor angle (around fixture origin) at the moment the drag started. */
  startCursorDeg: number;
}

/**
 * Begin a drag: record the fixture's current rotation + the cursor
 * angle so subsequent moves are relative, not absolute. This is why
 * grabbing the ring 40° away from 0° doesn't cause an instant jump
 * to 40°; only *delta* cursor motion changes the fixture.
 */
export function beginDrag(
  fixtureOrigin: Vec3,
  cursorWorldPoint: Vec3,
  currentRotationDeg: number,
): GizmoDragSession {
  return {
    startFixtureDeg: normalizeDeg(currentRotationDeg),
    startCursorDeg: xzAngleDeg(fixtureOrigin, cursorWorldPoint),
  };
}

/**
 * Compute the new fixture rotation while dragging.
 *
 * The rotation is: startFixtureDeg + (current cursor angle − start
 * cursor angle), then snapped to `step`.
 *
 * Note: we flip the sign of the cursor delta so dragging the handle
 * visually clockwise (from +Y camera perspective) rotates the
 * fixture clockwise too. Without the flip, the fixture would rotate
 * opposite to the user's hand, which feels wrong.
 */
export function dragToRotation(
  session: GizmoDragSession,
  fixtureOrigin: Vec3,
  cursorWorldPoint: Vec3,
  step: number,
): number {
  const currentCursorDeg = xzAngleDeg(fixtureOrigin, cursorWorldPoint);
  // CCW is positive in our angle convention; drag feels natural when
  // handle follows cursor, so no sign flip needed.
  const deltaDeg = currentCursorDeg - session.startCursorDeg;
  const raw = session.startFixtureDeg + deltaDeg;
  return snapDeg(raw, step);
}
